/**
 * Algopay Monetize SDK — Express/Hono paymentMiddleware
 * Req 13: 1-line API monetization for Algorand
 *
 * AWAL (Coinbase) equivalent: paymentMiddleware from x402-express (Base/EVM)
 * Algopay version: @x402-avm/express compatible + pure implementation fallback
 *
 * Usage (Express):
 * ─────────────────────────────────────────────────────────────────────
 * import { paymentMiddleware } from "@algopay/x402";
 *
 * const payment = paymentMiddleware(PAY_TO_ADDRESS, {
 *   "GET /api/data":   { price: "$0.05", network: "algorand-testnet" },
 *   "POST /api/query": { price: "$0.25", description: "Run a query" },
 * });
 *
 * app.get("/api/data", payment, (req, res) => { ... });
 * ─────────────────────────────────────────────────────────────────────
 *
 * How it works:
 *  1. REQUEST comes in
 *  2. Middleware checks "Authorization: x402 <proof>" header
 *  3. If missing → return HTTP 402 with X-Payment challenge header
 *  4. If present → verify USDC tx on Algorand Indexer
 *  5. If verified → call next() (allow request through)
 *
 * Compatible with: Express.js, Hono (via adapters)
 */

import algosdk from "algosdk";
import { Request, Response, NextFunction } from "express";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Simple price string: "$0.05" */
type PriceString = string;

export interface RouteConfig {
  price: PriceString | number;   // "$0.05" or 0.05 (USDC amount)
  network?: "algorand-testnet" | "algorand-mainnet";
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  maxTimeoutSeconds?: number;
}

/** Route map: "METHOD /path" → price or RouteConfig */
export type RouteMap = Record<string, PriceString | number | RouteConfig>;

export interface AlgopayMiddlewareOptions {
  network?: "algorand-testnet" | "algorand-mainnet";
  indexerUrl?: string;
  indexerToken?: string;
  facilitatorUrl?: string;   // GoPlausible facilitator for verification
  usdcAssetId?: number;      // defaults based on network
  replayWindowSec?: number;  // replay protection window (default: 300s)
}

// ─── Parse Helpers ────────────────────────────────────────────────────────────

function parsePrice(price: PriceString | number): number {
  if (typeof price === "number") return price;
  // "$0.05" → 0.05
  return parseFloat(price.replace("$", "").trim());
}

function parseRouteConfig(val: PriceString | number | RouteConfig): RouteConfig {
  if (typeof val === "string" || typeof val === "number") {
    return { price: val };
  }
  return val;
}

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

// ─── Payment Challenge Header ─────────────────────────────────────────────────

function buildPaymentChallenge(
  payToAddress: string,
  priceUsdc: number,
  network: string,
  usdcAssetId: number,
  description?: string
): string {
  return JSON.stringify({
    price_usdc: priceUsdc,
    pay_to: payToAddress,
    network: network === "algorand-mainnet" ? "algorand-mainnet" : "algorand-testnet",
    asset_id: usdcAssetId,
    description: description ?? "Pay to access this endpoint",
  });
}

// ─── Replay Protection (simple in-memory set) ─────────────────────────────────

const usedProofs = new Map<string, number>(); // txId → timestamp

function isReplay(txId: string, windowSec: number): boolean {
  const used = usedProofs.get(txId);
  if (!used) return false;
  if (Date.now() / 1000 - used > windowSec) {
    usedProofs.delete(txId);
    return false;
  }
  return true;
}

function markUsed(txId: string): void {
  usedProofs.set(txId, Math.floor(Date.now() / 1000));
}

// ─── On-chain Payment Verification ───────────────────────────────────────────

interface PaymentProof {
  txId: string;
  network: string;
  asset: string;
}

async function verifyPaymentOnChain(
  proof: PaymentProof,
  expectedPayTo: string,
  expectedPriceUsdc: number,
  usdcAssetId: number,
  indexerUrl: string,
  indexerToken: string
): Promise<{ valid: boolean; reason?: string }> {
  const indexer = new algosdk.Indexer(indexerToken, indexerUrl, "");

  try {
    const txInfo = await indexer.lookupTransactionByID(proof.txId).do();
    const tx = (txInfo as any).transaction ?? txInfo;

    // Must be an asset transfer
    if (tx["tx-type"] !== "axfer") {
      return { valid: false, reason: "Transaction is not an asset transfer" };
    }

    // Check asset ID matches USDC
    const assetId = tx["asset-transfer-transaction"]?.["asset-id"] ?? tx.assetid;
    if (Number(assetId) !== usdcAssetId) {
      return { valid: false, reason: `Wrong asset: expected USDC (${usdcAssetId}), got ${assetId}` };
    }

    // Check recipient
    const receiver =
      tx["asset-transfer-transaction"]?.receiver ??
      tx.receiver ?? "";
    if (receiver !== expectedPayTo) {
      return { valid: false, reason: `Wrong recipient: expected ${expectedPayTo}` };
    }

    // Check amount (USDC has 6 decimals)
    const amount = Number(tx["asset-transfer-transaction"]?.amount ?? tx.amount ?? 0);
    const expectedMicro = Math.floor(expectedPriceUsdc * 1_000_000);
    if (amount < expectedMicro) {
      return {
        valid: false,
        reason: `Insufficient payment: got ${amount} micro-USDC, need ${expectedMicro}`,
      };
    }

    // Check transaction is confirmed (has confirmed-round)
    const confirmedRound = tx["confirmed-round"];
    if (!confirmedRound) {
      return { valid: false, reason: "Transaction not yet confirmed on-chain" };
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, reason: `Verification error: ${err.message}` };
  }
}

// ─── Core paymentMiddleware ───────────────────────────────────────────────────

/**
 * paymentMiddleware — Drop-in Express middleware for x402 API monetization.
 *
 * @param payToAddress  Your Algorand wallet address (receives USDC payments)
 * @param routes        Route map: "GET /path" → price or RouteConfig
 * @param options       Optional network/indexer/facilitator config
 *
 * @example
 * const payment = paymentMiddleware("YOUR_ALGO_ADDRESS", {
 *   "GET /api/data": "$0.05",
 *   "POST /api/query": { price: "$0.25", description: "Run a query" },
 * });
 * app.get("/api/data", payment, (req, res) => res.json({ data: "..." }));
 */
export function paymentMiddleware(
  payToAddress: string,
  routes: RouteMap,
  options: AlgopayMiddlewareOptions = {}
) {
  const network = options.network ?? "algorand-testnet";

  const isMainnet = network === "algorand-mainnet";
  const usdcAssetId = options.usdcAssetId ?? (isMainnet ? 31566704 : 10458941);
  const indexerUrl = options.indexerUrl ?? (
    isMainnet
      ? "https://mainnet-idx.algonode.cloud"
      : "https://testnet-idx.algonode.cloud"
  );
  const indexerToken = options.indexerToken ?? "";
  const replayWindowSec = options.replayWindowSec ?? 300;

  // Validate address
  try {
    algosdk.decodeAddress(payToAddress);
  } catch {
    throw new Error(`paymentMiddleware: invalid payToAddress: "${payToAddress}"`);
  }

  // Parse route configs
  const parsedRoutes = new Map<string, RouteConfig>();
  for (const [key, val] of Object.entries(routes)) {
    parsedRoutes.set(key, parseRouteConfig(val));
  }

  return async function algoPayMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const method = req.method.toUpperCase();
    const path = req.path;
    const key = routeKey(method, path);

    // Not a protected route → pass through
    const routeConfig = parsedRoutes.get(key);
    if (!routeConfig) {
      return next();
    }

    const priceUsdc = parsePrice(routeConfig.price);
    const authHeader = req.headers["authorization"] as string | undefined;

    // ── No payment header → return 402 challenge ──────────────────────────
    if (!authHeader?.startsWith("x402 ")) {
      const challenge = buildPaymentChallenge(
        payToAddress,
        priceUsdc,
        network,
        usdcAssetId,
        routeConfig.description
      );

      res.status(402);
      res.setHeader("X-Payment", challenge);
      res.setHeader("Content-Type", "application/json");
      return res.json({
        error: "Payment Required",
        x402: true,
        payment: JSON.parse(challenge),
        instructions: [
          "1. Build a USDC transfer to the 'pay_to' address",
          "2. Broadcast the transaction on Algorand",
          "3. Retry this request with: Authorization: x402 <base64(JSON{txId,network,asset}))>",
        ],
      });
    }

    // ── Payment proof present → verify ────────────────────────────────────
    let proof: PaymentProof;
    try {
      const b64 = authHeader.slice("x402 ".length).trim();
      proof = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Malformed x402 authorization header" });
    }

    if (!proof.txId) {
      return res.status(400).json({ error: "Missing txId in payment proof" });
    }

    // Replay protection
    if (isReplay(proof.txId, replayWindowSec)) {
      return res.status(402).json({
        error: "Payment Replay Detected",
        message: "This transaction has already been used. Please submit a new payment.",
      });
    }

    // Verify on-chain
    const verification = await verifyPaymentOnChain(
      proof,
      payToAddress,
      priceUsdc,
      usdcAssetId,
      indexerUrl,
      indexerToken
    );

    if (!verification.valid) {
      return res.status(402).json({
        error: "Payment Verification Failed",
        reason: verification.reason,
      });
    }

    // Mark as used (replay protection)
    markUsed(proof.txId);

    // Attach payment info to request for downstream handlers
    (req as any).algopay = {
      txId: proof.txId,
      paidAmount: priceUsdc,
      payerNetwork: proof.network,
    };

    return next();
  };
}

// ─── Shorthand decorator for single routes ────────────────────────────────────

/**
 * Convenience: create middleware for a single route config.
 * @example
 * app.get("/api/data", paywall("$0.05"), handler);
 */
export function paywall(
  price: PriceString | number,
  payToAddress: string,
  options?: AlgopayMiddlewareOptions & { description?: string }
) {
  return paymentMiddleware(payToAddress, {
    "*": { price, description: options?.description },
  }, options);
}

// ─── OpenAPI / Bazaar Registration Helper ─────────────────────────────────────

/**
 * Generate the route manifest for GoPlausible Bazaar auto-indexing.
 * Call this to register your paid endpoints with the Bazaar discovery service.
 */
export function generateBazaarManifest(
  payToAddress: string,
  routes: RouteMap,
  metadata: {
    name: string;
    description: string;
    serviceUrl: string;
    provider?: string;
    tags?: string[];
  },
  options: AlgopayMiddlewareOptions = {}
): Record<string, unknown> {
  const network = options.network ?? "algorand-testnet";
  const usdcAssetId = options.usdcAssetId ?? (network === "algorand-mainnet" ? 31566704 : 10458941);

  const parsedRoutes = Object.entries(routes).map(([key, val]) => {
    const cfg = parseRouteConfig(val);
    const [method, path] = key.split(" ", 2);
    return {
      method,
      path,
      price_usdc: parsePrice(cfg.price),
      description: cfg.description ?? "",
      network,
      asset_id: usdcAssetId,
      pay_to: payToAddress,
    };
  });

  return {
    name: metadata.name,
    description: metadata.description,
    service_url: metadata.serviceUrl,
    provider: metadata.provider ?? "",
    tags: metadata.tags ?? [],
    routes: parsedRoutes,
    x402: true,
    blockchain: "algorand",
  };
}
