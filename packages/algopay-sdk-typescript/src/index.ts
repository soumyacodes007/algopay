/**
 * @algopay/x402 — TypeScript SDK entry point
 * Re-exports the paymentMiddleware and related types from src/middleware.ts
 * (which lives in src/monetize/middleware.ts in the monorepo)
 */

export {
    paymentMiddleware,
    paywall,
    generateBazaarManifest,
    type RouteConfig,
    type RouteMap,
    type AlgopayMiddlewareOptions,
} from "./middleware.js";
