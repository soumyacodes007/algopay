/**
 * @algopay/x402 TypeScript SDK — Test Suite
 * Req 13 Phase 6 tests:
 *   - TS middleware returns 402 on unpaid request (Unit)
 *   - TS middleware passes on valid tx hash (Integration mock)
 *   - Replay attack is blocked
 *   - generateBazaarManifest produces correct schema
 *
 * Run: vitest run
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { paymentMiddleware, generateBazaarManifest } from "../src/index.js";
import type { Request, Response, NextFunction } from "express";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_PAY_TO = "TESTINGGYWBBFR6MT3EZLLVYLZZOKWXKDPBEIJEBMRCJJCN2O3VQ";
const TEST_TX_ID = "TESTTXIDABCDEF1234567890ABCDEF1234567890ABCDEF12345";

function makeProofHeader(txId: string = TEST_TX_ID): string {
    const proof = { txId, network: "algorand-testnet", asset: "USDC" };
    return `x402 ${Buffer.from(JSON.stringify(proof)).toString("base64")}`;
}

function makeMockReq(opts: { path?: string; method?: string; auth?: string } = {}): Request {
    return {
        method: opts.method ?? "GET",
        path: opts.path ?? "/api/data",
        headers: { authorization: opts.auth ?? "" },
    } as unknown as Request;
}

function makeMockRes() {
    const res: any = {
        _status: 200,
        _headers: {} as Record<string, string>,
        _body: null as any,
    };
    res.status = (code: number) => { res._status = code; return res; };
    res.setHeader = (k: string, v: string) => { res._headers[k] = v; return res; };
    res.json = (body: any) => { res._body = body; return res; };
    return res as ReturnType<typeof makeMockRes>;
}

const next: NextFunction = vi.fn() as any;

// ─── Tests: no payment → 402 ──────────────────────────────────────────────────

describe("paymentMiddleware — no payment", () => {
    it("returns HTTP 402 when no Authorization header", async () => {
        const mw = paymentMiddleware(TEST_PAY_TO, {
            "GET /api/data": "$0.05",
        });
        const req = makeMockReq({ auth: "" });
        const res = makeMockRes();
        await mw(req, res as any, next);
        expect(res._status).toBe(402);
        expect(res._body.x402).toBe(true);
        expect(res._body.payment.price_usdc).toBe(0.05);
        expect(res._body.payment.pay_to).toBe(TEST_PAY_TO);
    });

    it("sets X-Payment challenge header on 402", async () => {
        const mw = paymentMiddleware(TEST_PAY_TO, {
            "GET /api/data": { price: "$0.10", description: "Test endpoint" },
        });
        const req = makeMockReq({ auth: "" });
        const res = makeMockRes();
        await mw(req, res as any, next);
        expect(res._status).toBe(402);
        const xPayment = JSON.parse(res._headers["X-Payment"]);
        expect(xPayment.price_usdc).toBe(0.10);
    });

    it("passes through unprotected routes", async () => {
        const mw = paymentMiddleware(TEST_PAY_TO, {
            "GET /api/paid": "$0.05",
        });
        const req = makeMockReq({ path: "/api/free", auth: "" });
        const res = makeMockRes();
        await mw(req, res as any, next);
        expect(next).toHaveBeenCalled();
    });
});

// ─── Tests: payment verification ─────────────────────────────────────────────

describe("paymentMiddleware — with payment", () => {
    beforeEach(() => {
        // Clear replay cache between tests by fresh middleware instance
        vi.clearAllMocks();
    });

    it("calls next() when on-chain verification succeeds", async () => {
        // Mock the Indexer lookup
        const { Indexer } = await import("algosdk");
        const mockLookup = vi.fn().mockResolvedValue({
            transaction: {
                "tx-type": "axfer",
                "confirmed-round": 12345678,
                "asset-transfer-transaction": {
                    "asset-id": 10458941,
                    receiver: TEST_PAY_TO,
                    amount: 50_000, // 0.05 USDC micro
                },
            },
        });

        vi.spyOn(Indexer.prototype, "lookupTransactionByID").mockReturnValue({
            do: mockLookup,
        } as any);

        const mw = paymentMiddleware(TEST_PAY_TO, { "GET /api/data": "$0.05" });
        const req = makeMockReq({ auth: makeProofHeader() });
        const res = makeMockRes();
        const nextFn = vi.fn();
        await mw(req, res as any, nextFn as any);
        expect(nextFn).toHaveBeenCalled();
        expect(res._status).not.toBe(402);
    });

    it("returns 402 when tx amount is insufficient", async () => {
        const { Indexer } = await import("algosdk");
        vi.spyOn(Indexer.prototype, "lookupTransactionByID").mockReturnValue({
            do: vi.fn().mockResolvedValue({
                transaction: {
                    "tx-type": "axfer",
                    "confirmed-round": 12345678,
                    "asset-transfer-transaction": {
                        "asset-id": 10458941,
                        receiver: TEST_PAY_TO,
                        amount: 1_000, // far too small
                    },
                },
            }),
        } as any);

        const mw = paymentMiddleware(TEST_PAY_TO, { "GET /api/data": "$1.00" });
        const req = makeMockReq({ auth: makeProofHeader() });
        const res = makeMockRes();
        await mw(req, res as any, next);
        expect(res._status).toBe(402);
        expect(res._body.error).toMatch(/Verification Failed/);
    });

    it("returns 402 for wrong recipient", async () => {
        const { Indexer } = await import("algosdk");
        vi.spyOn(Indexer.prototype, "lookupTransactionByID").mockReturnValue({
            do: vi.fn().mockResolvedValue({
                transaction: {
                    "tx-type": "axfer",
                    "confirmed-round": 1,
                    "asset-transfer-transaction": {
                        "asset-id": 10458941,
                        receiver: "WRONG_ADDRESS_HERE",
                        amount: 50_000,
                    },
                },
            }),
        } as any);

        const mw = paymentMiddleware(TEST_PAY_TO, { "GET /api/data": "$0.05" });
        const req = makeMockReq({ auth: makeProofHeader() });
        const res = makeMockRes();
        await mw(req, res as any, next);
        expect(res._status).toBe(402);
    });

    it("blocks replay attacks (same txId twice)", async () => {
        const { Indexer } = await import("algosdk");
        vi.spyOn(Indexer.prototype, "lookupTransactionByID").mockReturnValue({
            do: vi.fn().mockResolvedValue({
                transaction: {
                    "tx-type": "axfer",
                    "confirmed-round": 1,
                    "asset-transfer-transaction": {
                        "asset-id": 10458941,
                        receiver: TEST_PAY_TO,
                        amount: 50_000,
                    },
                },
            }),
        } as any);

        const REPLAY_TX = `REPLAY_${Date.now()}`;
        const mw = paymentMiddleware(TEST_PAY_TO, { "GET /api/data": "$0.05" });

        // First request — should pass
        const req1 = makeMockReq({ auth: makeProofHeader(REPLAY_TX) });
        const res1 = makeMockRes();
        const nextFn = vi.fn();
        await mw(req1, res1 as any, nextFn);
        expect(nextFn).toHaveBeenCalledTimes(1);

        // Second request with same txId — replay attack
        const req2 = makeMockReq({ auth: makeProofHeader(REPLAY_TX) });
        const res2 = makeMockRes();
        const nextFn2 = vi.fn();
        await mw(req2, res2 as any, nextFn2);
        expect(nextFn2).not.toHaveBeenCalled();
        expect(res2._status).toBe(402);
        expect(res2._body.error).toMatch(/Replay/);
    });
});

// ─── Tests: generateBazaarManifest ────────────────────────────────────────────

describe("generateBazaarManifest", () => {
    it("produces correct Bazaar manifest schema", () => {
        const manifest = generateBazaarManifest(
            TEST_PAY_TO,
            {
                "GET /api/weather": "$0.05",
                "POST /api/query": { price: "$0.25", description: "Run query" },
            },
            {
                name: "Weather API",
                description: "Real-time weather data",
                serviceUrl: "https://api.example.com",
                tags: ["weather", "data"],
            }
        );

        expect(manifest.name).toBe("Weather API");
        expect(manifest.x402).toBe(true);
        expect(manifest.blockchain).toBe("algorand");
        expect(Array.isArray(manifest.routes)).toBe(true);
        const routes = manifest.routes as any[];
        expect(routes).toHaveLength(2);
        expect(routes[0].price_usdc).toBe(0.05);
        expect(routes[1].price_usdc).toBe(0.25);
    });

    it("defaults to testnet USDC asset ID", () => {
        const manifest = generateBazaarManifest(
            TEST_PAY_TO,
            { "GET /": "$0.01" },
            { name: "Test", description: "d", serviceUrl: "http://x" }
        );
        const routes = manifest.routes as any[];
        expect(routes[0].asset_id).toBe(10458941);
    });
});
