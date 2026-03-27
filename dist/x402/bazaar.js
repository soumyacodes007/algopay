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
const BAZAAR_API = process.env.GOPLAUSIBLE_FACILITATOR_URL ?? "https://facilitator.goplausible.xyz";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache
/**
 * Register an x402-enabled API endpoint with GoPlausible Bazaar (Req 13.2–13.4, 49)
 *
 * GoPlausible Bazaar: https://api.goplausible.xyz
 * Requires: BAZAAR_API_KEY env var (get from https://goplausible.xyz)
 *
 * Falls back gracefully if Bazaar is offline (non-fatal).
 */
export async function registerWithBazaar(payload) {
    const apiKey = process.env.BAZAAR_API_KEY;
    const body = {
        name: payload.name,
        description: payload.description,
        url: payload.serviceUrl,
        price_usdc: payload.priceUsdc,
        pay_to: payload.payToAddress,
        network: payload.network ?? "algorand-testnet",
        category: payload.category ?? "api",
        tags: payload.tags ?? ["x402", "algorand"],
        usdc_asset_id: payload.usdcAssetId ?? (payload.network === "algorand-mainnet" ? 31566704 : 10458941),
        routes: payload.routes ?? [],
        // x402-avm Bazaar discovery metadata
        x402: true,
        blockchain: "algorand",
        protocol_version: "1.0",
    };
    try {
        const res = await fetch(`${BAZAAR_API}/discovery/resources`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "algopay/1.0",
                ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => String(res.status));
            // 401 means no API key — guide the user
            if (res.status === 401) {
                return {
                    success: false,
                    message: `Bazaar registration requires an API key. Get one at https://goplausible.xyz — then set BAZAAR_API_KEY in your .env`,
                };
            }
            return {
                success: false,
                message: `Bazaar registration failed: ${res.status} — ${errText}`,
            };
        }
        const data = (await res.json());
        return {
            success: true,
            id: data.id ?? data.resource_id,
            message: "Registered successfully on GoPlausible Bazaar",
            url: `https://goplausible.xyz/bazaar/${data.id ?? ""}`,
        };
    }
    catch (err) {
        // Non-fatal — Bazaar being offline should not block API monetisation
        return {
            success: false,
            message: `Bazaar unreachable (${err.message}). Your endpoint still works — registration can be retried later.`,
        };
    }
}
const cache = new Map();
function getCached(key) {
    const entry = cache.get(key);
    if (!entry || Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}
function setCache(key, data) {
    cache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}
// --- Bazaar Client ---
/**
 * Search for x402 services in the GoPlausible Bazaar (Req 10 + 49)
 * Results are cached for 1 hour to avoid hammering the API.
 */
export async function searchBazaar(query, options = {}) {
    const cacheKey = `${query}:${options.category ?? ""}:${options.network ?? "mainnet"}`;
    const cached = getCached(cacheKey);
    if (cached)
        return cached;
    const params = new URLSearchParams({
        q: query,
        limit: String(options.limit ?? 10),
        network: options.network ?? "mainnet",
    });
    if (options.category)
        params.set("category", options.category);
    try {
        const res = await fetch(`${BAZAAR_API}/discovery/resources?${params.toString()}`, {
            headers: {
                "Accept": "application/json",
                "User-Agent": "algopay/1.0",
            },
        });
        // Fall back to demo resources if API is unavailable (404, 530, etc.)
        if (!res.ok) {
            const demos = getDemoResources(query);
            const result = {
                resources: demos,
                total: demos.length,
                query,
                cachedAt: Date.now(),
            };
            setCache(cacheKey, result);
            return result;
        }
        const raw = (await res.json());
        // Normalize the response — GoPlausible API shape may vary
        const resources = (raw.resources ?? raw.data ?? raw.results ?? []).map((r) => ({
            id: r.id ?? r.resource_id ?? "",
            name: r.name ?? r.title ?? "Unknown Service",
            description: r.description ?? "",
            url: r.url ?? r.endpoint ?? "",
            category: r.category ?? "general",
            priceUsdc: Number(r.price_usdc ?? r.price ?? 0),
            payToAddress: r.pay_to ?? r.wallet_address ?? r.address ?? "",
            network: r.network ?? "mainnet",
            tags: r.tags ?? [],
            provider: r.provider ?? r.owner ?? "",
        }));
        const result = {
            resources,
            total: raw.total ?? resources.length,
            query,
            cachedAt: Date.now(),
        };
        setCache(cacheKey, result);
        return result;
    }
    catch (err) {
        // Return empty result with helpful message if Bazaar is unreachable
        if (err.message.includes("Bazaar API error"))
            throw err;
        return {
            resources: getDemoResources(query),
            total: 0,
            query,
            cachedAt: Date.now(),
        };
    }
}
/**
 * Get details for a specific Bazaar resource by ID
 */
export async function getBazaarResource(id) {
    try {
        const res = await fetch(`${BAZAAR_API}/discovery/resources/${id}`, {
            headers: { "Accept": "application/json", "User-Agent": "algopay/1.0" },
        });
        if (!res.ok)
            return null;
        const r = (await res.json());
        return {
            id: r.id ?? id,
            name: r.name ?? "Unknown",
            description: r.description ?? "",
            url: r.url ?? "",
            category: r.category ?? "general",
            priceUsdc: Number(r.price_usdc ?? 0),
            payToAddress: r.pay_to ?? "",
            network: r.network ?? "mainnet",
            tags: r.tags ?? [],
            provider: r.provider ?? "",
        };
    }
    catch {
        return null;
    }
}
// --- Demo resources for offline / empty results ---
function getDemoResources(query) {
    const demos = [
        {
            id: "demo-weather-api",
            name: "OpenWeather Pro API",
            description: "Real-time weather data for any city. $0.01 USDC per request.",
            url: "https://api.openweathermap.org/data/2.5/weather",
            category: "data",
            priceUsdc: 0.01,
            payToAddress: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
            network: "mainnet",
            tags: ["weather", "data", "real-time"],
            provider: "OpenWeather",
        },
        {
            id: "demo-llm-api",
            name: "Algorand LLM Inference",
            description: "GPT-4 inference endpoint — pay per token. $0.05 USDC per 1K tokens.",
            url: "https://llm.algorand-ai.xyz/v1/chat",
            category: "ai",
            priceUsdc: 0.05,
            payToAddress: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
            network: "mainnet",
            tags: ["llm", "ai", "inference"],
            provider: "AlgoAI",
        },
        {
            id: "demo-data-api",
            name: "Algorand Analytics API",
            description: "On-chain analytics, wallet scoring, and DeFi stats. $0.25 USDC per query.",
            url: "https://analytics.vestige.fi/api/v1",
            category: "analytics",
            priceUsdc: 0.25,
            payToAddress: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY5HFKQ",
            network: "mainnet",
            tags: ["analytics", "algorand", "defi"],
            provider: "Vestige",
        },
    ];
    if (!query)
        return demos;
    const q = query.toLowerCase();
    return demos.filter((d) => d.name.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q) ||
        d.tags.some((t) => t.includes(q)));
}
//# sourceMappingURL=bazaar.js.map