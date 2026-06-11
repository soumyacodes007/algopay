import { createHash, randomUUID } from 'crypto'
import type { SellerCaip2 } from '../core/networks.js'

export interface HubPaymentRequest {
  correlationId: string
  sellerNetwork: SellerCaip2
  paymentRequirements: unknown
  userContext: {
    algorandAddress: string
    maxDebitAtomic: string
  }
}

export interface HubRequestAuthHeaders {
  'x-pixa-auth-version': 'pixa-hub-auth-v1'
  'x-pixa-address': string
  'x-pixa-timestamp': string
  'x-pixa-nonce': string
  'x-pixa-body-sha256': string
  'x-pixa-signature': string
}

export interface HubPaymentResult {
  success: boolean
  paymentSignature?: string
  settlementNetwork?: string
  transactionId?: string
  error?: string
}

const DEFAULT_PIXA_HUB_URL = 'https://pixa-hub-production-051b.up.railway.app'

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function buildAuthMessage(input: {
  address: string
  correlationId: string
  sellerNetwork: string
  maxDebitAtomic: string
  bodySha256: string
  timestamp: string
  nonce: string
}): string {
  return JSON.stringify({
    domain: 'pixa-hub-v1',
    address: input.address,
    method: 'POST',
    path: '/api/pay',
    correlationId: input.correlationId,
    sellerNetwork: input.sellerNetwork,
    maxDebitAtomic: input.maxDebitAtomic,
    bodySha256: input.bodySha256,
    timestamp: input.timestamp,
    nonce: input.nonce
  })
}

async function signHubPaymentRequest(
  request: HubPaymentRequest,
  algorandMnemonic: string
): Promise<HubRequestAuthHeaders> {
  const algosdk = await import('algosdk')
  const { sk, addr } = algosdk.default.mnemonicToSecretKey(algorandMnemonic)
  const derivedAddress = algosdk.default.encodeAddress(addr.publicKey)

  if (request.userContext.algorandAddress !== derivedAddress) {
    throw new Error(
      `Hub request address mismatch: request says ${request.userContext.algorandAddress}, mnemonic derives ${derivedAddress}`
    )
  }

  const body = JSON.stringify(request)
  const bodySha256 = sha256Hex(body)
  const timestamp = new Date().toISOString()
  const nonce = randomUUID()
  const message = buildAuthMessage({
    address: derivedAddress,
    correlationId: request.correlationId,
    sellerNetwork: request.sellerNetwork,
    maxDebitAtomic: request.userContext.maxDebitAtomic,
    bodySha256,
    timestamp,
    nonce
  })
  const signature = algosdk.default.signBytes(
    new TextEncoder().encode(message),
    sk
  )

  return {
    'x-pixa-auth-version': 'pixa-hub-auth-v1',
    'x-pixa-address': derivedAddress,
    'x-pixa-timestamp': timestamp,
    'x-pixa-nonce': nonce,
    'x-pixa-body-sha256': bodySha256,
    'x-pixa-signature': Buffer.from(signature).toString('base64')
  }
}

/**
 * Sends a payment request to Pixa Hub.
 * The desktop authenticates the request by signing a canonical envelope
 * with the user's Algorand key instead of using a shared secret.
 */
export async function sendToHub(
  request: HubPaymentRequest,
  algorandMnemonic: string
): Promise<HubPaymentResult> {
  const hubUrl = process.env.PIXA_HUB_URL ?? DEFAULT_PIXA_HUB_URL

  if (!algorandMnemonic) {
    throw new Error(
      'ALGORAND_MNEMONIC is required to sign Pixa Hub payment requests'
    )
  }

  const authHeaders = await signHubPaymentRequest(request, algorandMnemonic)
  const response = await fetch(`${hubUrl}/api/pay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders
    },
    body: JSON.stringify(request)
  })

  const data = (await response.json()) as HubPaymentResult

  if (!response.ok || !data.success) {
    throw new Error(
      `Pixa Hub error (${response.status}): ${data.error ?? 'Unknown error'}`
    )
  }

  return data
}
