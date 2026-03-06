/**
 * Production Hardening — Error Handling, Retry, Rate Limiting, Logging
 * Reqs: 22-23 (errors/logging), 30-31 (retry/timeouts), 40-41 (sanitization/shutdown)
 *
 * This module provides production-grade utilities used across the entire
 * Algopay codebase. Import what you need:
 *
 *   import { AlgopayError, retry, rateLimiter, logger, sanitize, validateEnv } from "./production.js";
 */

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HIERARCHY (Req 22)
// ═══════════════════════════════════════════════════════════════════════════════

export class AlgopayError extends Error {
  code: string;
  statusCode: number;
  retryable: boolean;

  constructor(message: string, opts: { code?: string; statusCode?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = "AlgopayError";
    this.code = opts.code ?? "ALGOPAY_ERROR";
    this.statusCode = opts.statusCode ?? 500;
    this.retryable = opts.retryable ?? false;
  }
}

export class AuthError extends AlgopayError {
  constructor(message: string) {
    super(message, { code: "AUTH_ERROR", statusCode: 401, retryable: false });
    this.name = "AuthError";
  }
}

export class GuardrailError extends AlgopayError {
  constructor(message: string) {
    super(message, { code: "GUARDRAIL_BLOCKED", statusCode: 403, retryable: false });
    this.name = "GuardrailError";
  }
}

export class NetworkError extends AlgopayError {
  constructor(message: string) {
    super(message, { code: "NETWORK_ERROR", statusCode: 502, retryable: true });
    this.name = "NetworkError";
  }
}

export class TransactionError extends AlgopayError {
  txId?: string;
  constructor(message: string, txId?: string) {
    super(message, { code: "TX_ERROR", statusCode: 500, retryable: false });
    this.name = "TransactionError";
    this.txId = txId;
  }
}

export class ValidationError extends AlgopayError {
  field?: string;
  constructor(message: string, field?: string) {
    super(message, { code: "VALIDATION_ERROR", statusCode: 400, retryable: false });
    this.name = "ValidationError";
    this.field = field;
  }
}

export class RateLimitError extends AlgopayError {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message, { code: "RATE_LIMITED", statusCode: 429, retryable: true });
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RETRY WITH EXPONENTIAL BACKOFF (Req 30-31)
// ═══════════════════════════════════════════════════════════════════════════════

export interface RetryOptions {
  maxAttempts?: number;       // default: 3
  initialDelayMs?: number;    // default: 500ms
  maxDelayMs?: number;        // default: 10000ms
  backoffFactor?: number;     // default: 2
  timeoutMs?: number;         // default: 30000ms (entire operation)
  retryOn?: (err: Error) => boolean;  // custom retry predicate
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 500,
    maxDelayMs = 10000,
    backoffFactor = 2,
    timeoutMs = 30000,
    retryOn = (err) => err instanceof AlgopayError ? err.retryable : true,
  } = options;

  const deadline = Date.now() + timeoutMs;
  let lastError: Error = new Error("retry: no attempts made");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Date.now() > deadline) {
      throw new AlgopayError(`Operation timed out after ${timeoutMs}ms`, {
        code: "TIMEOUT", retryable: false,
      });
    }

    try {
      return await fn();
    } catch (err: any) {
      lastError = err;

      if (attempt === maxAttempts || !retryOn(err)) {
        throw err;
      }

      const delay = Math.min(initialDelayMs * Math.pow(backoffFactor, attempt - 1), maxDelayMs);
      const jitter = delay * (0.5 + Math.random() * 0.5); // add jitter

      logger.warn(`Retry attempt ${attempt}/${maxAttempts} after ${Math.round(jitter)}ms: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, jitter));
    }
  }

  throw lastError;
}

// ═══════════════════════════════════════════════════════════════════════════════
// RATE LIMITER — Token Bucket (Req 43)
// ═══════════════════════════════════════════════════════════════════════════════

export interface RateLimiterConfig {
  maxTokens: number;          // bucket capacity
  refillRatePerSec: number;   // tokens added per second
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRatePerSec: number;
  private lastRefill: number;

  constructor(config: RateLimiterConfig) {
    this.maxTokens = config.maxTokens;
    this.tokens = config.maxTokens;
    this.refillRatePerSec = config.refillRatePerSec;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerSec);
    this.lastRefill = now;
  }

  consume(tokens = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  consumeOrThrow(tokens = 1): void {
    if (!this.consume(tokens)) {
      const waitMs = Math.ceil(((tokens - this.tokens) / this.refillRatePerSec) * 1000);
      throw new RateLimitError(`Rate limit exceeded. Retry after ${waitMs}ms`, waitMs);
    }
  }

  get remaining(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

// Pre-configured rate limiters
export const rateLimiters = {
  api: new TokenBucketRateLimiter({ maxTokens: 10, refillRatePerSec: 2 }),   // 10 burst, 2/sec
  auth: new TokenBucketRateLimiter({ maxTokens: 5, refillRatePerSec: 0.1 }), // 5 burst, 6/min
  send: new TokenBucketRateLimiter({ maxTokens: 3, refillRatePerSec: 0.5 }), // 3 burst, 30/min
};

// ═══════════════════════════════════════════════════════════════════════════════
// STRUCTURED LOGGING (Req 23)
// ═══════════════════════════════════════════════════════════════════════════════

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  private level: LogLevel;
  private json: boolean;

  constructor(level: LogLevel = "info", json = false) {
    this.level = level;
    this.json = json;
  }

  setLevel(level: LogLevel): void { this.level = level; }
  setJson(json: boolean): void { this.json = json; }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.level];
  }

  private format(level: LogLevel, message: string, data?: Record<string, unknown>): string {
    if (this.json) {
      return JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...data,
      });
    }
    const ts = new Date().toISOString().slice(11, 23);
    const prefix = level === "error" ? "❌" : level === "warn" ? "⚠️" : level === "info" ? "ℹ️" : "🔍";
    const extra = data ? ` ${JSON.stringify(data)}` : "";
    return `[${ts}] ${prefix} ${message}${extra}`;
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("debug")) console.debug(this.format("debug", msg, data));
  }

  info(msg: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("info")) console.log(this.format("info", msg, data));
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("warn")) console.warn(this.format("warn", msg, data));
  }

  error(msg: string, data?: Record<string, unknown>): void {
    if (this.shouldLog("error")) console.error(this.format("error", msg, data));
  }
}

export const logger = new Logger(
  (process.env.ALGOPAY_LOG_LEVEL as LogLevel) ?? "info",
  process.env.ALGOPAY_LOG_FORMAT === "json"
);

// ═══════════════════════════════════════════════════════════════════════════════
// INPUT SANITIZATION (Req 40)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sanitize and validate common inputs.
 */
export const sanitize = {
  /** Validate Algorand address (58 chars, base32) */
  address(input: string): string {
    const cleaned = input.trim();
    if (!/^[A-Z2-7]{58}$/.test(cleaned)) {
      throw new ValidationError(`Invalid Algorand address: "${cleaned.slice(0, 20)}..."`, "address");
    }
    return cleaned;
  },

  /** Validate and parse amount (positive number) */
  amount(input: string | number): number {
    const num = typeof input === "string" ? parseFloat(input.replace("$", "").trim()) : input;
    if (isNaN(num) || num <= 0 || !isFinite(num)) {
      throw new ValidationError(`Invalid amount: "${input}"`, "amount");
    }
    if (num > 1_000_000_000) {
      throw new ValidationError("Amount exceeds maximum (1B)", "amount");
    }
    return num;
  },

  /** Validate email */
  email(input: string): string {
    const cleaned = input.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
      throw new ValidationError(`Invalid email: "${cleaned}"`, "email");
    }
    return cleaned;
  },

  /** Validate network */
  network(input: string): "testnet" | "mainnet" {
    const cleaned = input.trim().toLowerCase();
    if (cleaned !== "testnet" && cleaned !== "mainnet") {
      throw new ValidationError(`Invalid network: "${cleaned}". Use testnet or mainnet`, "network");
    }
    return cleaned;
  },

  /** Validate asset ID (positive integer or 0 for ALGO) */
  assetId(input: string | number): number {
    const num = typeof input === "string" ? parseInt(input, 10) : input;
    if (isNaN(num) || num < 0 || !Number.isInteger(num)) {
      throw new ValidationError(`Invalid asset ID: "${input}"`, "assetId");
    }
    return num;
  },

  /** Sanitize URL */
  url(input: string): string {
    const cleaned = input.trim();
    try {
      new URL(cleaned);
      return cleaned;
    } catch {
      throw new ValidationError(`Invalid URL: "${cleaned.slice(0, 50)}..."`, "url");
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CONFIG VALIDATION (Req 43-44)
// ═══════════════════════════════════════════════════════════════════════════════

export interface EnvConfig {
  JWT_SECRET: string;
  ALGOPAY_BACKEND_URL: string;
  ALGOPAY_NETWORK: "testnet" | "mainnet";
  ALGOPAY_LOG_LEVEL: LogLevel;
  // Optional production env vars
  SENDGRID_API_KEY?: string;
  REDIS_URL?: string;
  INTERMEZZO_URL?: string;
  INTERMEZZO_TOKEN?: string;
}

/**
 * Validate required environment variables.
 * In dev mode, defaults are used for missing optional vars.
 */
export function validateEnv(mode: "development" | "production" = "development"): EnvConfig {
  const env = process.env;

  const config: EnvConfig = {
    JWT_SECRET: env.JWT_SECRET ?? (mode === "development" ? "dev-secret-change-in-production" : ""),
    ALGOPAY_BACKEND_URL: env.ALGOPAY_BACKEND_URL ?? "http://localhost:3001",
    ALGOPAY_NETWORK: sanitize.network(env.ALGOPAY_NETWORK ?? "testnet"),
    ALGOPAY_LOG_LEVEL: (env.ALGOPAY_LOG_LEVEL as LogLevel) ?? "info",
    SENDGRID_API_KEY: env.SENDGRID_API_KEY,
    REDIS_URL: env.REDIS_URL,
    INTERMEZZO_URL: env.INTERMEZZO_URL,
    INTERMEZZO_TOKEN: env.INTERMEZZO_TOKEN,
  };

  // Production validations
  if (mode === "production") {
    const missing: string[] = [];
    if (!config.JWT_SECRET || config.JWT_SECRET === "dev-secret-change-in-production") {
      missing.push("JWT_SECRET");
    }
    if (!config.SENDGRID_API_KEY) missing.push("SENDGRID_API_KEY");
    if (!config.INTERMEZZO_URL) missing.push("INTERMEZZO_URL");
    if (!config.INTERMEZZO_TOKEN) missing.push("INTERMEZZO_TOKEN");

    if (missing.length > 0) {
      throw new AlgopayError(
        `Missing required environment variables for production: ${missing.join(", ")}`,
        { code: "ENV_MISSING", statusCode: 500 }
      );
    }
  }

  return config;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN (Req 41)
// ═══════════════════════════════════════════════════════════════════════════════

type CleanupFn = () => Promise<void> | void;
const cleanupHandlers: CleanupFn[] = [];

/**
 * Register a cleanup handler for graceful shutdown.
 */
export function onShutdown(fn: CleanupFn): void {
  cleanupHandlers.push(fn);
}

/**
 * Install process signal handlers for graceful shutdown.
 * Call this once at app startup.
 */
export function installShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down gracefully...`);

    for (const fn of cleanupHandlers) {
      try {
        await fn();
      } catch (err: any) {
        logger.error(`Cleanup error: ${err.message}`);
      }
    }

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
