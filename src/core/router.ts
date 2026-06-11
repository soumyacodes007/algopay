import type { AppConfig } from '@/types.js'
import {
  isAlgorandSellerNetwork,
  isHubSupportedSellerNetwork,
  normalizeSellerNetwork,
  type SellerCaip2
} from './networks.js'

export type RouteTier = 'NATIVE_ALGORAND' | 'CROSS_CHAIN_HUB'

export interface RouteDecision {
  tier: RouteTier
  sellerNetwork: SellerCaip2
}

export class NonRoutableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NonRoutableError'
  }
}

/**
 * Determines how to handle an x402 payment based on the seller's
 * requested network and the user's wallet configuration.
 *
 * Phase 2 routing rules:
 * - Algorand seller -> pay locally
 * - Hub-supported seller -> route to Pixa Hub
 */
export function determinePaymentRouting(
  sellerNetwork: string,
  config: AppConfig
): RouteDecision {
  const normalizedSellerNetwork = normalizeSellerNetwork(sellerNetwork)

  if (isAlgorandSellerNetwork(normalizedSellerNetwork)) {
    if (!config.canPayAlgorand) {
      throw new NonRoutableError(
        'Seller accepts Algorand but ALGORAND_MNEMONIC is not configured.'
      )
    }
    return { tier: 'NATIVE_ALGORAND', sellerNetwork: normalizedSellerNetwork }
  }

  if (isHubSupportedSellerNetwork(normalizedSellerNetwork)) {
    if (!config.canPayAlgorand) {
      throw new NonRoutableError(
        `Seller requires ${normalizedSellerNetwork}. Pixa Hub cross-chain routing requires ALGORAND_MNEMONIC to lock funds.`
      )
    }
    return { tier: 'CROSS_CHAIN_HUB', sellerNetwork: normalizedSellerNetwork }
  }

  throw new NonRoutableError(
    `Seller network ${sellerNetwork} is not supported. ` +
      `Supported: Algorand (native), Base, Polygon, Arbitrum, World, Solana (via hub).`
  )
}
