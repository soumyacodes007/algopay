import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import algosdk from 'algosdk'

import { DesktopAuthError, verifyDesktopPayRequest } from '../src/core/auth.js'

const AUTH_VERSION = 'pixa-hub-auth-v1'

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

function makeSignedRequest(overrides?: {
  rawBody?: string
  timestamp?: string
  bodySha256?: string
  signer?: algosdk.Account
  address?: string
}) {
  const signer = overrides?.signer ?? algosdk.generateAccount()
  const address = overrides?.address ?? signer.addr.toString()
  const requestBody = {
    correlationId: 'corr-123',
    sellerNetwork: 'eip155:84532',
    userContext: {
      algorandAddress: address,
      maxDebitAtomic: '250000'
    }
  }

  const rawBody = overrides?.rawBody ?? JSON.stringify(requestBody)
  const timestamp = overrides?.timestamp ?? new Date().toISOString()
  const bodySha256 = overrides?.bodySha256 ?? sha256Hex(rawBody)
  const nonce = 'nonce-123'
  const message = buildAuthMessage({
    address,
    correlationId: requestBody.correlationId,
    sellerNetwork: requestBody.sellerNetwork,
    maxDebitAtomic: requestBody.userContext.maxDebitAtomic,
    bodySha256,
    timestamp,
    nonce
  })
  const signature = Buffer.from(
    algosdk.signBytes(new TextEncoder().encode(message), signer.sk)
  ).toString('base64')

  return {
    rawBody,
    requestBody,
    headers: {
      authVersion: AUTH_VERSION,
      address,
      timestamp,
      nonce,
      bodySha256,
      signature
    }
  }
}

test('verifyDesktopPayRequest accepts a valid signed request', () => {
  const request = makeSignedRequest()

  const verified = verifyDesktopPayRequest(request)

  assert.equal(verified.address, request.headers.address)
  assert.equal(verified.timestamp, request.headers.timestamp)
  assert.equal(verified.nonce, request.headers.nonce)
})

test('verifyDesktopPayRequest rejects mismatched body/header addresses', () => {
  const request = makeSignedRequest()
  request.requestBody.userContext.algorandAddress = algosdk
    .generateAccount()
    .addr.toString()

  assert.throws(
    () => verifyDesktopPayRequest(request),
    (error: unknown) =>
      error instanceof DesktopAuthError &&
      error.message ===
        'Signed address does not match request body algorandAddress'
  )
})

test('verifyDesktopPayRequest rejects expired timestamps', () => {
  const request = makeSignedRequest({
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString()
  })

  assert.throws(
    () => verifyDesktopPayRequest(request),
    (error: unknown) =>
      error instanceof DesktopAuthError &&
      error.message === 'Auth timestamp expired'
  )
})

test('verifyDesktopPayRequest rejects body hash mismatches', () => {
  const request = makeSignedRequest({
    bodySha256: '0'.repeat(64)
  })

  assert.throws(
    () => verifyDesktopPayRequest(request),
    (error: unknown) =>
      error instanceof DesktopAuthError &&
      error.message === 'Body hash mismatch'
  )
})

test('verifyDesktopPayRequest rejects invalid Algorand signatures', () => {
  const request = makeSignedRequest()
  request.headers.signature = Buffer.from(new Uint8Array(64).fill(7)).toString(
    'base64'
  )

  assert.throws(
    () => verifyDesktopPayRequest(request),
    (error: unknown) =>
      error instanceof DesktopAuthError &&
      error.message === 'Invalid Algorand signature'
  )
})
