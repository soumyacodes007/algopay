/**
 * NFD (Non-Fungible Domains) — Algorand Name Service
 * Equivalent to ENS on Ethereum. Resolves "alice.algo" → Algorand address.
 *
 * API: https://api.nf.domains
 * Docs: https://api-docs.nf.domains
 *
 * Supports:
 *   - Forward resolution: "alice.algo" → ALGO_ADDRESS
 *   - Reverse resolution: ALGO_ADDRESS → "alice.algo"
 *   - Detection: any string ending in .algo is an NFD name
 */

const NFD_API_MAINNET = "https://api.nf.domains";
const NFD_API_TESTNET = "https://api.testnet.nf.domains";

// --- Types ---

export interface NfdRecord {
  name: string;
  owner: string;
  depositAccount: string;   // the address that receives funds
  caAlgo?: string[];         // verified Algorand addresses
  avatar?: string;
  verified: boolean;
}

// --- Detection ---

/**
 * Check if a string looks like an NFD name (e.g. "alice.algo")
 */
export function isNfdName(input: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.algo$/i.test(input.trim());
}

// --- Forward Resolution ---

/**
 * Resolve an NFD name to an Algorand address.
 * @param name e.g. "alice.algo"
 * @param network "testnet" or "mainnet"
 * @returns Algorand address, or null if not found
 */
export async function resolveNfdToAddress(
  name: string,
  network: "testnet" | "mainnet" = "mainnet"
): Promise<string | null> {
  const baseUrl = network === "mainnet" ? NFD_API_MAINNET : NFD_API_TESTNET;
  const cleanName = name.trim().toLowerCase();

  try {
    const res = await fetch(`${baseUrl}/nfd/${cleanName}`, {
      headers: { "Accept": "application/json" },
    });

    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) return null; // treat all other errors as 'not found' gracefully

    const data = (await res.json()) as any;

    // depositAccount is the primary receiving address
    const address =
      data.depositAccount ??
      data.caAlgo?.[0] ??
      data.owner ??
      null;

    return address;
  } catch (err: any) {
    if (err.message.includes("NFD API error")) throw err;
    // Network error — return null (offline gracefully)
    return null;
  }
}

// --- Reverse Resolution ---

/**
 * Resolve an Algorand address to an NFD name (reverse lookup).
 * @returns NFD name like "alice.algo", or null if not found
 */
export async function resolveAddressToNfd(
  address: string,
  network: "testnet" | "mainnet" = "mainnet"
): Promise<string | null> {
  const baseUrl = network === "mainnet" ? NFD_API_MAINNET : NFD_API_TESTNET;

  try {
    const res = await fetch(
      `${baseUrl}/nfd/lookup?address=${address}&view=tiny&allowUnverified=false`,
      { headers: { "Accept": "application/json" } }
    );

    if (res.status === 404) return null;
    if (!res.ok) return null;

    const data = (await res.json()) as any;

    // API returns object with address as key
    const records = data[address];
    if (Array.isArray(records) && records.length > 0) {
      return records[0].name ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

// --- Smart Resolve (used in send/trade commands) ---

/**
 * If input is an NFD name, resolve to address. Otherwise return as-is.
 * Throws if NFD name doesn't resolve.
 */
export async function smartResolve(
  input: string,
  network: "testnet" | "mainnet"
): Promise<{ address: string; nfdName?: string }> {
  if (!isNfdName(input)) {
    return { address: input };
  }

  let address: string | null;
  try {
    address = await resolveNfdToAddress(input, network);
  } catch {
    address = null;
  }

  if (!address) {
    throw new Error(`NFD name "${input}" could not be resolved to an Algorand address`);
  }

  return { address, nfdName: input };
}
