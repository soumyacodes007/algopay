import type { PaymentRequirements } from './create-payment.js'

const SUPPORTED_NETWORKS = new Set([
  'eip155:8453', // Base Mainnet
  'eip155:84532' // Base Sepolia
])

function normalizeNetwork(network: string): string {
  if (network === 'base') return 'eip155:8453'
  if (network === 'base-sepolia') return 'eip155:84532'
  return network
}

/**
 * Parses and validates the PaymentRequired body sent from the seller's 402 response.
 * The desktop strips the 402 header and forwards the raw JSON to the hub.
 */
export function parsePaymentRequirements(raw: unknown): PaymentRequirements {
  if (!raw || typeof raw !== 'object') {
    throw new Error('paymentRequirements must be an object')
  }

  const req = raw as Record<string, unknown>

  if (typeof req.x402Version !== 'number') {
    throw new Error('paymentRequirements.x402Version must be a number')
  }

  if (!Array.isArray(req.accepts) || req.accepts.length === 0) {
    throw new Error('paymentRequirements.accepts must be a non-empty array')
  }

  return req as unknown as PaymentRequirements
}

/**
 * Finds the best supported network from the accepts list.
 * Returns the CAIP-2 network string if supported, or null if none match.
 */
export function resolveSellerNetwork(
  paymentRequirements: PaymentRequirements
): string | null {
  for (const accept of paymentRequirements.accepts) {
    const normalizedNetwork = normalizeNetwork(accept.network)
    if (
      SUPPORTED_NETWORKS.has(normalizedNetwork) &&
      accept.scheme === 'exact'
    ) {
      return normalizedNetwork
    }
  }
  return null
}

/**
 * Extracts the seller's payTo address from the matching accept entry.
 */
export function getSellerAddress(
  paymentRequirements: PaymentRequirements,
  network: string
): string {
  const accept = paymentRequirements.accepts.find(
    a =>
      normalizeNetwork(a.network) === normalizeNetwork(network) &&
      a.scheme === 'exact'
  )
  if (!accept) throw new Error(`No accept entry for network ${network}`)
  return accept.payTo
}

/**
 * Extracts the required payment amount in atomic units.
 */
export function getPaymentAmountAtomic(
  paymentRequirements: PaymentRequirements,
  network: string
): bigint {
  const accept = paymentRequirements.accepts.find(
    a =>
      normalizeNetwork(a.network) === normalizeNetwork(network) &&
      a.scheme === 'exact'
  )
  if (!accept) throw new Error(`No accept entry for network ${network}`)
  const amount = accept.amount ?? accept.maxAmountRequired
  if (!amount) {
    throw new Error(
      `Accept entry for network ${network} is missing both 'amount' and 'maxAmountRequired'`
    )
  }
  return BigInt(amount)
}
