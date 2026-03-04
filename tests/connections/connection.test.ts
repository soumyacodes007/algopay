/**
 * Algopay Connection Tests
 *
 * These tests verify that ALL external services are reachable
 * before any implementation code runs. (Req 55)
 *
 * Run: npm run test:connections
 */

import { describe, it, expect } from "vitest";
import { getNetworkEndpoints } from "../../src/config.js";

const NETWORK = (process.env.ALGOPAY_NETWORK ?? "testnet") as
    | "testnet"
    | "mainnet";
const endpoints = getNetworkEndpoints(NETWORK);

describe("Connection Tests (Req 55)", () => {
    it("1. Algod node is reachable and returns status", async () => {
        const res = await fetch(`${endpoints.algodUrl}/v2/status`, {
            headers: { "X-Algo-API-Token": endpoints.algodToken },
        });

        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data).toHaveProperty("last-round");
        expect(typeof data["last-round"]).toBe("number");

        console.log(
            `  ✓ Algod ${NETWORK}: last-round = ${data["last-round"]}`
        );
    });

    it("2. Indexer is reachable and returns health", async () => {
        const res = await fetch(`${endpoints.indexerUrl}/health`, {
            headers: { "X-Indexer-API-Token": endpoints.indexerToken },
        });

        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data).toHaveProperty("round");

        console.log(`  ✓ Indexer ${NETWORK}: round = ${data["round"]}`);
    });

    it("3. GoPlausible API is reachable", async () => {
        const res = await fetch("https://api.goplausible.xyz/docs", {
            method: "GET",
        });

        // Accept 200 or 301/302 redirect — as long as it's not 5xx
        expect(res.status).toBeLessThan(500);

        console.log(`  ✓ GoPlausible API: status = ${res.status}`);
    });

    it("4. USDC asset exists on the network", async () => {
        const res = await fetch(
            `${endpoints.indexerUrl}/v2/assets/${endpoints.usdcAssetId}`,
            {
                headers: { "X-Indexer-API-Token": endpoints.indexerToken },
            }
        );

        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.asset.params["unit-name"]).toMatch(/USDC/i);

        console.log(
            `  ✓ USDC Asset ${endpoints.usdcAssetId}: ${data.asset.params["unit-name"]} on ${NETWORK}`
        );
    });

    it("5. Algod can return suggested transaction parameters", async () => {
        const res = await fetch(
            `${endpoints.algodUrl}/v2/transactions/params`,
            {
                headers: { "X-Algo-API-Token": endpoints.algodToken },
            }
        );

        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data).toHaveProperty("genesis-id");
        expect(data).toHaveProperty("min-fee");

        console.log(
            `  ✓ Tx Params: genesis = ${data["genesis-id"]}, min-fee = ${data["min-fee"]}`
        );
    });

    it("6. Indexer can search for transactions", async () => {
        const res = await fetch(
            `${endpoints.indexerUrl}/v2/transactions?limit=1`,
            {
                headers: { "X-Indexer-API-Token": endpoints.indexerToken },
            }
        );

        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data).toHaveProperty("transactions");
        expect(Array.isArray(data.transactions)).toBe(true);

        console.log(
            `  ✓ Indexer tx search works: returned ${data.transactions.length} tx(s)`
        );
    });

    it("7. Algod /versions endpoint confirms node software", async () => {
        const res = await fetch(`${endpoints.algodUrl}/versions`, {
            headers: { "X-Algo-API-Token": endpoints.algodToken },
        });

        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data).toHaveProperty("genesis_id");

        console.log(
            `  ✓ Node version: genesis = ${data.genesis_id}`
        );
    });
});
