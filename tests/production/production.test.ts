/**
 * Production Hardening Tests — Phase 10
 *
 * Tests: error hierarchy, retry logic, rate limiter, sanitization, env validation.
 * Run: npx vitest run tests/production/
 */

import { describe, it, expect } from "vitest";
import {
  AlgopayError, AuthError, GuardrailError, NetworkError,
  TransactionError, ValidationError, RateLimitError,
  retry, TokenBucketRateLimiter, sanitize, validateEnv, logger,
} from "../../src/utils/production.js";

// ─── Error Hierarchy ─────────────────────────────────────────────────────────

describe("Production: Error Hierarchy", () => {
  it("AlgopayError has correct defaults", () => {
    const err = new AlgopayError("test");
    expect(err.name).toBe("AlgopayError");
    expect(err.code).toBe("ALGOPAY_ERROR");
    expect(err.statusCode).toBe(500);
    expect(err.retryable).toBe(false);
    expect(err instanceof Error).toBe(true);
  });

  it("AuthError has 401 status", () => {
    const err = new AuthError("not logged in");
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.retryable).toBe(false);
  });

  it("NetworkError is retryable", () => {
    const err = new NetworkError("timeout");
    expect(err.retryable).toBe(true);
    expect(err.statusCode).toBe(502);
  });

  it("TransactionError stores txId", () => {
    const err = new TransactionError("broadcast failed", "TXID123");
    expect(err.txId).toBe("TXID123");
  });

  it("ValidationError stores field name", () => {
    const err = new ValidationError("bad input", "amount");
    expect(err.field).toBe("amount");
    expect(err.statusCode).toBe(400);
  });

  it("RateLimitError stores retryAfterMs", () => {
    const err = new RateLimitError("too fast", 5000);
    expect(err.retryAfterMs).toBe(5000);
    expect(err.statusCode).toBe(429);
    expect(err.retryable).toBe(true);
  });
});

// ─── Retry Logic ─────────────────────────────────────────────────────────────

describe("Production: retry", () => {
  it("returns result on first success", async () => {
    const result = await retry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("retries on failure then succeeds", async () => {
    let attempts = 0;
    const result = await retry(async () => {
      attempts++;
      if (attempts < 3) throw new NetworkError("fail");
      return "ok";
    }, { maxAttempts: 3, initialDelayMs: 10 });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("throws after max attempts", async () => {
    await expect(
      retry(() => Promise.reject(new NetworkError("always fails")), {
        maxAttempts: 2, initialDelayMs: 10,
      })
    ).rejects.toThrow("always fails");
  });

  it("does not retry non-retryable errors", async () => {
    let attempts = 0;
    await expect(
      retry(async () => {
        attempts++;
        throw new AuthError("not authorized");
      }, {
        maxAttempts: 3, initialDelayMs: 10,
        retryOn: (err) => err instanceof AlgopayError ? err.retryable : false,
      })
    ).rejects.toThrow("not authorized");
    expect(attempts).toBe(1);
  });

  it("respects timeout", async () => {
    await expect(
      retry(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), 100)),
        { maxAttempts: 100, initialDelayMs: 10, timeoutMs: 50 }
      )
    ).rejects.toThrow();
  });
});

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

describe("Production: TokenBucketRateLimiter", () => {
  it("allows requests within limit", () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 5, refillRatePerSec: 1 });
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
  });

  it("rejects requests over limit", () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 2, refillRatePerSec: 0.001 });
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(true);
    expect(limiter.consume()).toBe(false); // bucket empty
  });

  it("consumeOrThrow throws RateLimitError", () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 1, refillRatePerSec: 0.001 });
    limiter.consume();
    expect(() => limiter.consumeOrThrow()).toThrow(RateLimitError);
  });

  it("remaining shows correct count", () => {
    const limiter = new TokenBucketRateLimiter({ maxTokens: 5, refillRatePerSec: 1 });
    expect(limiter.remaining).toBe(5);
    limiter.consume();
    expect(limiter.remaining).toBe(4);
  });
});

// ─── Input Sanitization ──────────────────────────────────────────────────────

describe("Production: sanitize", () => {
  it("address: validates correct Algorand address", () => {
    const addr = "GD64YIY3TWGDMCNPP553DZPPR6LDUSFQOIJVFDPPXWEG3FVOJCCDBBHU5A";
    expect(sanitize.address(addr)).toBe(addr);
  });

  it("address: rejects short address", () => {
    expect(() => sanitize.address("TOOSHORT")).toThrow(ValidationError);
  });

  it("amount: parses valid amounts", () => {
    expect(sanitize.amount("5.00")).toBe(5.0);
    expect(sanitize.amount("$1.50")).toBe(1.5);
    expect(sanitize.amount(0.01)).toBe(0.01);
  });

  it("amount: rejects zero and negative", () => {
    expect(() => sanitize.amount("0")).toThrow(ValidationError);
    expect(() => sanitize.amount("-5")).toThrow(ValidationError);
  });

  it("amount: rejects absurd values", () => {
    expect(() => sanitize.amount("99999999999")).toThrow(ValidationError);
  });

  it("email: validates correct email", () => {
    expect(sanitize.email("user@example.com")).toBe("user@example.com");
    expect(sanitize.email("  USER@Example.COM  ")).toBe("user@example.com");
  });

  it("email: rejects invalid email", () => {
    expect(() => sanitize.email("not-an-email")).toThrow(ValidationError);
  });

  it("network: validates testnet/mainnet", () => {
    expect(sanitize.network("testnet")).toBe("testnet");
    expect(sanitize.network("MAINNET")).toBe("mainnet");
  });

  it("network: rejects invalid network", () => {
    expect(() => sanitize.network("devnet")).toThrow(ValidationError);
  });

  it("url: validates correct URL", () => {
    expect(sanitize.url("https://api.example.com/v1")).toBe("https://api.example.com/v1");
  });

  it("url: rejects invalid URL", () => {
    expect(() => sanitize.url("not a url")).toThrow(ValidationError);
  });
});

// ─── Environment Config ──────────────────────────────────────────────────────

describe("Production: validateEnv", () => {
  it("returns valid config in development mode", () => {
    const config = validateEnv("development");
    expect(config.JWT_SECRET).toBeDefined();
    expect(config.ALGOPAY_NETWORK).toBe("testnet");
    expect(config.ALGOPAY_LOG_LEVEL).toBeDefined();
  });

  it("production mode requires JWT_SECRET", () => {
    const origSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => validateEnv("production")).toThrow("Missing required environment variables");
    if (origSecret) process.env.JWT_SECRET = origSecret;
  });
});
