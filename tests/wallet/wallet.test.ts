/**
 * Wallet Tests
 *
 * Tests the wallet query module against REAL Algorand testnet.
 * Uses a well-known testnet address with balance.
 *
 * Reqs: 4 (status), 5 (balance), 20 (history), 27 (tx params)
 *
 * Run: npx vitest run tests/wallet/
 */

import { describe, it, expect } from "vitest";
import * as wallet from "../../src/wallet/queries.js";
import { IntermezzoClient } from "../../src/wallet/intermezzo.js";

const NETWORK = "testnet" as const;

// Use a well-known testnet address — the dispenser
const KNOWN_ADDRESS =
    "GD64YIY3TWGDMCNPP553DZPPR6LDUSFQOIJVFDPPXWEG3FVOJCCDBBHU5A";

describe("Wallet: getStatus (Req 4)", () => {
    it("returns wallet status with network info", async () => {
        const status = await wallet.getStatus(KNOWN_ADDRESS, NETWORK);

        expect(status.address).toBe(KNOWN_ADDRESS);
        expect(status.network).toBe("testnet");
        expect(status.authenticated).toBe(true);
        expect(status.algodStatus.lastRound).toBeGreaterThan(0);

        console.log(
            `  ✓ Status: lastRound = ${status.algodStatus.lastRound}`
        );
    });
});

describe("Wallet: getBalance (Req 5)", () => {
    it("returns ALGO balance for known address", async () => {
        const balance = await wallet.getBalance(KNOWN_ADDRESS, NETWORK);

        expect(balance.address).toBe(KNOWN_ADDRESS);
        expect(balance.network).toBe("testnet");
        expect(balance.algo.amount).toBeGreaterThanOrEqual(0);
        expect(typeof balance.algo.displayAmount).toBe("string");

        console.log(
            `  ✓ Balance: ${balance.algo.displayAmount} ALGO, ${balance.assets.length} ASA(s)`
        );
    });
});

describe("Wallet: getHistory (Req 20)", () => {
    it("returns transaction history", async () => {
        const txns = await wallet.getHistory(KNOWN_ADDRESS, NETWORK, {
            limit: 3,
        });

        expect(Array.isArray(txns)).toBe(true);
        // Known active address should have transactions
        if (txns.length > 0) {
            const tx = txns[0];
            expect(tx).toHaveProperty("id");
            expect(tx).toHaveProperty("type");
            expect(tx).toHaveProperty("sender");
            expect(tx).toHaveProperty("fee");
            expect(tx).toHaveProperty("confirmedRound");
        }

        console.log(
            `  ✓ History: returned ${txns.length} transaction(s)`
        );
    });

    it("supports limit parameter", async () => {
        const txns = await wallet.getHistory(KNOWN_ADDRESS, NETWORK, {
            limit: 2,
        });
        expect(txns.length).toBeLessThanOrEqual(2);
    });
});

describe("Wallet: getSuggestedParams (Req 27)", () => {
    it("returns valid transaction parameters", async () => {
        const params = await wallet.getSuggestedParams(NETWORK);

        expect(params).toHaveProperty("fee");
        expect(params).toHaveProperty("firstValid");
        expect(params).toHaveProperty("lastValid");

        console.log(
            `  ✓ Params: fee = ${params.fee}, firstValid = ${params.firstValid}`
        );
    });
});

describe("Wallet: Intermezzo Client", () => {
    it("mock mode health check returns true", async () => {
        const client = new IntermezzoClient();
        const healthy = await client.healthCheck();
        expect(healthy).toBe(true);
    });

    it("mock mode createAccount returns address", async () => {
        const client = new IntermezzoClient();
        const result = await client.createAccount("test-session");
        expect(result.address).toBeDefined();
        expect(typeof result.address).toBe("string");
        expect(result.address.length).toBeGreaterThan(40);

        console.log(`  ✓ Mock account: ${result.address.slice(0, 10)}...`);
    });
});
