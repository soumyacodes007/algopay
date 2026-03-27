/**
 * GoPlausible Bazaar Client — x402 Service Discovery
 * Req 10: discover x402-enabled services
 * Req 49: GoPlausible Bazaar integration
 *
 * API Base: https://facilitator.goplausible.xyz
 * Endpoint: GET /discovery/resources
 *
 * The Bazaar is the official Algorand x402 service registry.
 * AI agents search for services here, then use x402 to pay.
 */
export interface BazaarResource {
    id: string;
    name: string;
    description: string;
    url: string;
    category: string;
    priceUsdc: number;
    payToAddress: string;
    network: string;
    tags: string[];
    provider: string;
}
export interface BazaarSearchResult {
    resources: BazaarResource[];
    total: number;
    query: string;
    cachedAt: number;
}
export interface BazaarRegistrationPayload {
    /** Service name shown in Bazaar */
    name: string;
    /** Short description */
    description: string;
    /** Publicly accessible base URL of your API */
    serviceUrl: string;
    /** USDC price per request */
    priceUsdc: number;
    /** Your Algorand wallet address that receives payments */
    payToAddress: string;
    /** "algorand-testnet" | "algorand-mainnet" */
    network?: string;
    /** Category tag */
    category?: string;
    /** Extra searchable tags */
    tags?: string[];
    /** Optional USDC asset ID override */
    usdcAssetId?: number;
    /** Route-level manifest (from generateBazaarManifest) */
    routes?: Array<{
        method: string;
        path: string;
        price_usdc: number;
        description?: string;
        asset_id?: number;
    }>;
}
export interface BazaarRegistrationResult {
    success: boolean;
    id?: string;
    message: string;
    url?: string;
}
/**
 * Register an x402-enabled API endpoint with GoPlausible Bazaar (Req 13.2–13.4, 49)
 *
 * GoPlausible Bazaar: https://api.goplausible.xyz
 * Requires: BAZAAR_API_KEY env var (get from https://goplausible.xyz)
 *
 * Falls back gracefully if Bazaar is offline (non-fatal).
 */
export declare function registerWithBazaar(payload: BazaarRegistrationPayload): Promise<BazaarRegistrationResult>;
/**
 * Search for x402 services in the GoPlausible Bazaar (Req 10 + 49)
 * Results are cached for 1 hour to avoid hammering the API.
 */
export declare function searchBazaar(query: string, options?: {
    category?: string;
    limit?: number;
    network?: "testnet" | "mainnet";
}): Promise<BazaarSearchResult>;
/**
 * Get details for a specific Bazaar resource by ID
 */
export declare function getBazaarResource(id: string): Promise<BazaarResource | null>;
//# sourceMappingURL=bazaar.d.ts.map