import { createHash } from 'crypto'
import algosdk from 'algosdk'

const AUTH_VERSION = 'pixa-hub-auth-v1'
const MAX_SKEW_MS = 2 * 60 * 1000

export class DesktopAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DesktopAuthError'
  }
}

export interface VerifiedDesktopAuth {
  address: string
  timestamp: string
  nonce: string
}

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

export function verifyDesktopPayRequest(params: {
  headers: {
    authVersion?: string
    address?: string
    timestamp?: string
    nonce?: string
    bodySha256?: string
    signature?: string
  }
  rawBody: string
  requestBody: {
    correlationId: string
    sellerNetwork?: string
    userContext?: {
      algorandAddress?: string
      maxDebitAtomic?: string
    }
  }
}): VerifiedDesktopAuth {
  const { headers, rawBody, requestBody } = params
  const { authVersion, address, timestamp, nonce, bodySha256, signature } =
    headers

  if (authVersion !== AUTH_VERSION) {
    throw new DesktopAuthError('Unsupported auth version')
  }
  if (
    !address ||
    !timestamp ||
    !nonce ||
    !bodySha256 ||
    !signature ||
    !requestBody.correlationId ||
    !requestBody.sellerNetwork ||
    !requestBody.userContext?.algorandAddress ||
    !requestBody.userContext?.maxDebitAtomic
  ) {
    throw new DesktopAuthError('Missing auth headers')
  }
  if (address !== requestBody.userContext.algorandAddress) {
    throw new DesktopAuthError(
      'Signed address does not match request body algorandAddress'
    )
  }

  const parsedTimestamp = Date.parse(timestamp)
  if (Number.isNaN(parsedTimestamp)) {
    throw new DesktopAuthError('Invalid auth timestamp')
  }
  if (Math.abs(Date.now() - parsedTimestamp) > MAX_SKEW_MS) {
    throw new DesktopAuthError('Auth timestamp expired')
  }

  const computedBodySha = sha256Hex(rawBody)
  if (computedBodySha !== bodySha256.toLowerCase()) {
    throw new DesktopAuthError('Body hash mismatch')
  }

  let signatureBytes: Uint8Array
  try {
    signatureBytes = Uint8Array.from(Buffer.from(signature, 'base64'))
  } catch {
    throw new DesktopAuthError('Invalid signature encoding')
  }

  const message = buildAuthMessage({
    address,
    correlationId: requestBody.correlationId,
    sellerNetwork: requestBody.sellerNetwork,
    maxDebitAtomic: requestBody.userContext.maxDebitAtomic,
    bodySha256: computedBodySha,
    timestamp,
    nonce
  })
  const verified = algosdk.verifyBytes(
    new TextEncoder().encode(message),
    signatureBytes,
    address
  )

  if (!verified) {
    throw new DesktopAuthError('Invalid Algorand signature')
  }

  return { address, timestamp, nonce }
}
