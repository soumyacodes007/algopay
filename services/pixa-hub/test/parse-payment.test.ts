import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getPaymentAmountAtomic,
  getSellerAddress,
  parsePaymentRequirements,
  resolveSellerNetwork
} from '../src/x402/parse-payment.js'

test('parsePaymentRequirements accepts a valid exact-payment payload', () => {
  const paymentRequirements = parsePaymentRequirements({
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'base-sepolia',
        payTo: '0xabc',
        amount: '1000',
        asset: 'USDC'
      }
    ]
  })

  assert.equal(resolveSellerNetwork(paymentRequirements), 'eip155:84532')
  assert.equal(getSellerAddress(paymentRequirements, 'eip155:84532'), '0xabc')
  assert.equal(
    getPaymentAmountAtomic(paymentRequirements, 'base-sepolia'),
    1000n
  )
})

test('resolveSellerNetwork ignores unsupported or non-exact schemes', () => {
  const paymentRequirements = parsePaymentRequirements({
    x402Version: 1,
    accepts: [
      {
        scheme: 'fixed',
        network: 'base',
        payTo: '0xignored',
        amount: '10',
        asset: 'USDC'
      },
      {
        scheme: 'exact',
        network: 'solana',
        payTo: 'ignored',
        amount: '10',
        asset: 'USDC'
      }
    ]
  })

  assert.equal(resolveSellerNetwork(paymentRequirements), null)
})

test('getPaymentAmountAtomic falls back to maxAmountRequired', () => {
  const paymentRequirements = parsePaymentRequirements({
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:8453',
        payTo: '0xdef',
        maxAmountRequired: '2500',
        asset: 'USDC'
      }
    ]
  })

  assert.equal(getPaymentAmountAtomic(paymentRequirements, 'base'), 2500n)
})

test('parsePaymentRequirements rejects malformed payloads', () => {
  assert.throws(
    () => parsePaymentRequirements(null),
    /paymentRequirements must be an object/
  )
  assert.throws(
    () => parsePaymentRequirements({ x402Version: '1', accepts: [] }),
    /paymentRequirements.x402Version must be a number/
  )
  assert.throws(
    () => parsePaymentRequirements({ x402Version: 1, accepts: [] }),
    /paymentRequirements.accepts must be a non-empty array/
  )
})

test('payment helpers reject missing network entries or missing amounts', () => {
  const missingNetwork = parsePaymentRequirements({
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'base-sepolia',
        payTo: '0xabc',
        amount: '1000',
        asset: 'USDC'
      }
    ]
  })
  const missingAmount = parsePaymentRequirements({
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: 'base',
        payTo: '0xdef',
        asset: 'USDC'
      }
    ]
  })

  assert.throws(
    () => getSellerAddress(missingNetwork, 'eip155:8453'),
    /No accept entry for network eip155:8453/
  )
  assert.throws(
    () => getPaymentAmountAtomic(missingAmount, 'base'),
    /missing both 'amount' and 'maxAmountRequired'/
  )
})
