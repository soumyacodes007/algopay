/**
 * @algopay/x402 TypeScript SDK — Test Suite
 *
 * Run from the monorepo root:  npx vitest run packages/algopay-sdk-typescript
 * Or from this directory:      npx vitest run
 *
 * Tests cover:
 *   - HTTP 402 returned on unauthenticated request
 *   - X-Payment challenge header set correctly
 *   - Unprotected routes pass through
 *   - Valid on-chain payment → next() called (mocked Indexer)
 *   - Insufficient payment amount → 402
 *   - Wrong recipient → 402
 *   - Replay attack blocked on second use of same txId
 *   - generateBazaarManifest produces correct schema
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use a direct relative path (no extension for Node resolution in tests)
import { paymentMiddleware, generateBazaarManifest } from "../src/middleware";

// ─── Minimal inline types (avoids requiring express in this package) ───────────

interface MockRequest {
    method: string;
    path: string;
    headers: Record<string, string>;
    [key: string]: unknown;
}

interface MockResponse {
    _status: number;
    _headers: Record<string, string>;
    _body: unknown;
    status(code: number): this;
    setHeader(key: string, value: string): this;
    json(body: unknown): this;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_PAY_TO = "TESTINGGYWBBFR6MT3EZLLVYLZZOKWXKDPBEIJEBMRCJJCN2O3VQ";
const TEST_TX_ID  = "TESTTXIDABCDEF1234567890ABCDEF1234567890ABCDEF12345";

function makeProofHeader(txId: string = TEST_TX_ID): string {
    const proof = { txId, network: "algorand-testnet", asset: "USDC" };
    return `x402 ${Buffer.from(JSON.stringify(proof)).toString("base64")}`;
}

function makeReq(opts: { path?: string; method?: string; auth?: string } = {}): MockRequest {
    return {
        method: opts.method ?? "GET",
        path:   opts.path   ?? "/api/data",
        headers: { authorization: opts.auth ?? "" },
    };
}

function makeRes(): MockResponse {
    const res = {
        _status:  200,
        _headers: {} as Record<string, string>,
        _body:    null as unknown,
        status(code: number) { this._status = code; return this; },
        setHeader(k: string, v: string) { this._headers[k] = v; return this; },
        json(body: unknown) { this._body = body; return this; },
    };
    return res;
}

/** Build a mock fulfilling algosdk Indexer.lookupTransactionByID() builder pattern */
function mockIndexerTx(txOverride: Record<string, unknown> = {}) {
    const defaultTx = {
        "tx-type": "axfer",
        "confirmed-round": 12_345_678,
        "asset-transfer-transaction": {
            "asset-id": 10_458_941,
            receiver:   TEST_PAY_TO,
            amount:     50_000,    // 0.05 USDC in micro-USDC
        },
        ...txOverride,
    };
    return {
        do: vi.fn().mockResolvedValue({ transaction: defaultTx }),
    };
}

// ─── Tests: no payment → 402 ──────────────────────────────────────────────────

describe("paymentMiddleware — no payment", () => {
    it("returns HTTP 402 when no Authorization header", async () => {
        const mw   = paymentMiddleware(TEST_PAY_TO, { "GET /api/data": "$0.05" });
        const req  = makeReq();
        const res  = makeRes();
        const next = vi.fn();

        await mw(req as any, res as any, next as any);

        expect(res._status).toBe(402);
        const body = res._body as any;
        expect(body.x402).toBe(true);
        expect(body.payment.price_usdc).toBe(0.05);
        expect(body.payment.pay_to).toBe(TEST_PAY_TO);
    });

    it("sets X-Payment challenge header on 402", async () => {
        const mw  = paymentMiddleware(TEST_PAY_TO, {
            "GET /api/data": { price: "$0.10", description: "Test endpoint" },
        });
        const req  = makeReq();
        const res  = makeRes();
        const next = vi.fn();

        await mw(req as any, res as any, next as any);

        expect(res._status).toBe(402);
        const xPayment = JSON.parse(res._headers["X-Payment"]);
        expect(xPayment.price_usdc).toBe(0.10);
    });

    it("passes through unprotected routes without payment", async () => {
        const mw  = paymentMiddleware(TEST_PAY_TO, { "GET /api/paid": "$0.05" });
        const req = makeReq({ path: "/api/free" });
        const res = makeRes();
        const next = vi.fn();

        await mw(req as any, res as any, next as any);

        expect(next).toHaveBeenCalled();
        expect(res._status).toBe(200); // unchanged
    });

    it("returns 400 on malformed base64 proof", async () => {
        const mw  = paymentMiddleware(TEST_PAY_TO, { "GET /api/data": "$0.05" });
        const req = makeReq({ auth: "x402 NOT!!!VALID___BASE64" });
        const res = makeRes();
        const next = vi.fn();

        await mw(req as any, res as any, next as any);

        expect(res._status).toBe(400);
    });
});

// ─── Tests: with payment ──────────────────────────────────────────────────────

describe("paymentMiddleware — with payment", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("calls next() when on-chain verification succeeds", async () => {
        const algosdk = await import("algosdk");
        vi.spyOn(algosdk.Indexer.prototype, "lookupTransactionByID")
            .mockReturnValue(mockIndexerTx() as any);

        const mw   = paymentMiddleware(TEST_PAY_TO, { "GET /api/data": "$0.05" });
        const req  = makeReq({ auth: makeProofHeader() });
        const res  = makeRes();
        const next = vi.fn();

        await mw(req as any, res as any, next as any);

        expect(next).toHaveBeenCalledOnce();
        expect(res._status).toBe(200); // not touched
    });

    it("returns 402 when tx amount is below required price", async () => {
        const algosdk = await import("algosdk");
        vi.spyOn(algosdk.Indexer.prototype, "lookupTransactionByID")
            .mockReturnValue(mockIndexerTx({
                "asset-transfer-transaction": {
                    "asset-id": 10_458_941,
                    receiver:   TEST_PAY_TO,
                    amount:     100, // way too small for $1.00
                },
            }) as any);

        const mw  = paymentMiddleware(TEST_PAY_TO, { "GET /api/data": "$1.00" });
        const req = makeReq({ auth: makeProofHeader() });
        const res = makeRes();
        const next = vi.fn();

        await mw(req as any, res as any, next as any);

        expect(next).not.toHaveBeenCalled();
        expect(res._status).toBe(402);
        expect((res._body as any).error).toMatch(/Verification Failed/);
    });

    it("returns 402 when recipient does not match pay_to", async () => {
        const algosdk = await import("algosdk");
        vi.spyOn(algosdk.Indexer.prototype, "lookupTransactionByID")
            .mockReturnValue(mockIndexerTx({
                "asset-transfer-transaction": {
                    "asset-id": 10_458_941,
                    receiver:   "WRONG_RECIPIENT_ADDRESS",
                    amount:     50_000,
                },
            }) as any);

        const mw  = paymentMiddleware(TEST_PAY_TO, { "GET /api/data": "$0.05" });
        const req = makeReq({ auth: makeProofHeader() });
        const res = makeRes();
        const next = vi.fn();

        await mw(req as any, res as any, next as any);

        expect(next).not.toHaveBeenCalled();
        expect(res._status).toBe(402);
    });

    it("blocks replay attack — same txId used twice", async () => {
        const algosdk = await import("algosdk");
        vi.spyOn(algosdk.Indexer.prototype, "lookupTransactionByID")
            .mockReturnValue(mockIndexerTx() as any);

        const REPLAY_TX = `REPLAY_${Date.now()}`;
        const mw = paymentMiddleware(TEST_PAY_TO, { "GET /api/data": "$0.05" });

        // First call — must succeed
        const next1 = vi.fn();
        await mw(makeReq({ auth: makeProofHeader(REPLAY_TX) }) as any, makeRes() as any, next1 as any);
        expect(next1).toHaveBeenCalledOnce();

        // Second call with same txId — replay, must be blocked
        const res2  = makeRes();
        const next2 = vi.fn();
        await mw(makeReq({ auth: makeProofHeader(REPLAY_TX) }) as any, res2 as any, next2 as any);
        expect(next2).not.toHaveBeenCalled();
        expect(res2._status).toBe(402);
        expect((res2._body as any).error).toMatch(/Replay/);
    });
});

// ─── Tests: generateBazaarManifest ────────────────────────────────────────────

describe("generateBazaarManifest", () => {
    it("produces correct Bazaar manifest schema", () => {
        const manifest = generateBazaarManifest(
            TEST_PAY_TO,
            {
                "GET /api/weather": "$0.05",
                "POST /api/query":  { price: "$0.25", description: "Run query" },
            },
            {
                name:        "Weather API",
                description: "Real-time weather data",
                serviceUrl:  "https://api.example.com",
                tags:        ["weather", "data"],
            }
        );

        expect(manifest.name).toBe("Weather API");
        expect(manifest.x402).toBe(true);
        expect(manifest.blockchain).toBe("algorand");
        expect(Array.isArray(manifest.routes)).toBe(true);

        const routes = manifest.routes as Array<Record<string, unknown>>;
        expect(routes).toHaveLength(2);
        expect(routes[0]!.price_usdc).toBe(0.05);
        expect(routes[1]!.price_usdc).toBe(0.25);
    });

    it("defaults to testnet USDC asset ID (10458941)", () => {
        const manifest = generateBazaarManifest(
            TEST_PAY_TO,
            { "GET /": "$0.01" },
            { name: "Test", description: "d", serviceUrl: "http://x" }
        );

        const routes = manifest.routes as Array<Record<string, unknown>>;
        expect(routes[0]!.asset_id).toBe(10_458_941);
    });

    it("uses mainnet USDC asset ID (31566704) when specified", () => {
        const manifest = generateBazaarManifest(
            TEST_PAY_TO,
            { "GET /": "$0.01" },
            { name: "Test", description: "d", serviceUrl: "http://x" },
            { network: "algorand-mainnet" }
        );

        const routes = manifest.routes as Array<Record<string, unknown>>;
        expect(routes[0]!.asset_id).toBe(31_566_704);
    });
});
