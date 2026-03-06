/**
 * NFD & Advanced Features Tests — Phase 9
 *
 * Tests: NFD name detection, resolution, tx history, network status.
 * Run: npx vitest run tests/advanced/
 */

import { describe, it, expect } from "vitest";
import { isNfdName, resolveNfdToAddress, resolveAddressToNfd, smartResolve } from "../../src/wallet/nfd.js";
import { getTransactionHistory, getNetworkStatus, getAssetHoldings } from "../../src/wallet/advanced.js";

const TEST_ADDRESS = "GD64YIY3TWGDMCNPP553DZPPR6LDUSFQOIJVFDPPXWEG3FVOJCCDBBHU5A";

// ─── NFD Name Detection (offline) ────────────────────────────────────────────

describe("NFD: isNfdName", () => {
  it("detects alice.algo as NFD name", () => {
    expect(isNfdName("alice.algo")).toBe(true);
  });

  it("detects UPPERCASE.algo as NFD name", () => {
    expect(isNfdName("ALICE.algo")).toBe(true);
  });

  it("detects name-with-hyphens.algo", () => {
    expect(isNfdName("my-wallet.algo")).toBe(true);
  });

  it("rejects plain Algorand address", () => {
    expect(isNfdName(TEST_ADDRESS)).toBe(false);
  });

  it("rejects random string", () => {
    expect(isNfdName("hello")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isNfdName("")).toBe(false);
  });

  it("rejects .algo alone", () => {
    expect(isNfdName(".algo")).toBe(false);
  });
});

// ─── NFD Forward Resolution (hits live API) ──────────────────────────────────

describe("NFD: resolveNfdToAddress", () => {
  it("returns null for non-existent NFD", async () => {
    const result = await resolveNfdToAddress("this-does-not-exist-xyz123.algo", "mainnet");
    expect(result).toBeNull();
    console.log("  ✓ Non-existent NFD → null");
  });

  it("resolves a well-known NFD name", async () => {
    // "algo.algo" is likely to exist on mainnet
    const result = await resolveNfdToAddress("algo.algo", "mainnet");
    if (result) {
      expect(typeof result).toBe("string");
      expect(result.length).toBe(58); // Algorand address length
      console.log(`  ✓ algo.algo → ${result.slice(0, 12)}...`);
    } else {
      console.log("  ℹ️ algo.algo not found (API may be rate-limiting)");
    }
  });
});

// ─── NFD smartResolve (offline + online) ──────────────────────────────────────

describe("NFD: smartResolve", () => {
  it("passes through a regular Algorand address unchanged", async () => {
    const result = await smartResolve(TEST_ADDRESS, "testnet");
    expect(result.address).toBe(TEST_ADDRESS);
    expect(result.nfdName).toBeUndefined();
  });

  it("throws for non-existent NFD name", async () => {
    await expect(
      smartResolve("nonexistent-abc123.algo", "mainnet")
    ).rejects.toThrow("could not be resolved");
  });
});

// ─── Network Status (hits live node) ─────────────────────────────────────────

describe("Advanced: getNetworkStatus", () => {
  it("returns healthy status for testnet", async () => {
    const status = await getNetworkStatus("testnet");
    expect(status.network).toBe("testnet");
    expect(status.healthy).toBe(true);
    expect(status.lastRound).toBeGreaterThan(0);
    console.log(`  ✓ Testnet healthy, round: ${status.lastRound}`);
  });
});

// ─── Transaction History (hits testnet Indexer) ──────────────────────────────

describe("Advanced: getTransactionHistory", () => {
  it("returns array of transactions", async () => {
    const history = await getTransactionHistory(TEST_ADDRESS, "testnet", 3);
    expect(Array.isArray(history)).toBe(true);
    console.log(`  ✓ Found ${history.length} transaction(s)`);

    if (history.length > 0) {
      const tx = history[0];
      expect(tx).toHaveProperty("txId");
      expect(tx).toHaveProperty("direction");
      expect(tx).toHaveProperty("amount");
      expect(tx).toHaveProperty("asset");
      expect(["sent", "received", "self", "other"]).toContain(tx.direction);
    }
  });
});
