/**
 * Seller network classification uses normalized CAIP-2 IDs internally.
 * Some sellers still emit legacy aliases like `base-sepolia`; normalize those
 * before routing so the rest of the stack can stay CAIP-2 based.
 */

export type SellerCaip2 = `${string}:${string}`

const SELLER_NETWORK_ALIASES: Record<string, SellerCaip2> = {
  base: 'eip155:8453',
  'base-sepolia': 'eip155:84532',
  algorand: 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
  'algorand-testnet': 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
}

// Algorand networks the local wallet can pay directly
const ALGORAND_SELLER_NETWORKS = new Set([
  'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=', // Mainnet
  'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=' // Testnet
])

// Non-Algorand networks the Pixa Hub can settle (CDP-verified as of April 2026)
// Source: https://docs.cdp.coinbase.com/x402/network-support
const HUB_SUPPORTED_SELLER_NETWORKS = new Set([
  'eip155:8453', // Base mainnet
  'eip155:84532', // Base Sepolia (testnet)
  'eip155:137', // Polygon mainnet
  'eip155:42161', // Arbitrum One mainnet
  'eip155:480', // World mainnet
  'eip155:4801', // World Sepolia (testnet)
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', // Solana mainnet
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' // Solana Devnet (testnet)
])

export function normalizeSellerNetwork(network: string): SellerCaip2 {
  return (SELLER_NETWORK_ALIASES[network] ?? network) as SellerCaip2
}

export function isAlgorandSellerNetwork(caip2: string): boolean {
  return ALGORAND_SELLER_NETWORKS.has(normalizeSellerNetwork(caip2))
}

export function isHubSupportedSellerNetwork(caip2: string): boolean {
  return HUB_SUPPORTED_SELLER_NETWORKS.has(normalizeSellerNetwork(caip2))
}
