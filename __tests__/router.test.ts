import { describe, it, expect, vi } from 'vitest'
import type { AppConfig } from '../src/types.js'
import {
  determinePaymentRouting,
  NonRoutableError
} from '../src/core/router.js'

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    stellarSecret: undefined,
    evmPrivateKey: undefined,
    algorandMnemonic: undefined,
    network: 'algorand-testnet',
    budget: { maxPerCall: '1.00', maxPerDay: '20.00' },
    canPay: false,
    canPayStellar: false,
    canPayEvm: false,
    canPayAlgorand: false,
    mode: 'READ_ONLY',
    reload: vi.fn(),
    ...overrides
  }
}

describe('determinePaymentRouting', () => {
  it('routes algorand sellers natively', () => {
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      mode: 'ALGORAND_ONLY'
    })

    const route = determinePaymentRouting('algorand-testnet', config)
    expect(route.tier).toBe('NATIVE_ALGORAND')
    expect(route.sellerNetwork).toBe(
      'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
    )
  })

  it('routes base sellers through the hub when algorand funding is configured', () => {
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      mode: 'ALGORAND_ONLY'
    })

    const route = determinePaymentRouting('base-sepolia', config)
    expect(route.tier).toBe('CROSS_CHAIN_HUB')
    expect(route.sellerNetwork).toBe('eip155:84532')
  })

  it('rejects algorand sellers when algorand signing is unavailable', () => {
    const config = makeConfig({
      canPay: true,
      canPayEvm: true,
      evmPrivateKey: '0xabc',
      mode: 'EVM_ONLY'
    })

    expect(() => determinePaymentRouting('algorand-testnet', config)).toThrow(
      NonRoutableError
    )
    expect(() => determinePaymentRouting('algorand-testnet', config)).toThrow(
      'ALGORAND_MNEMONIC'
    )
  })

  it('rejects hub-supported sellers when algorand funding is unavailable', () => {
    const config = makeConfig({
      canPay: true,
      canPayStellar: true,
      stellarSecret: 'STEST...',
      mode: 'STELLAR_ONLY'
    })

    expect(() => determinePaymentRouting('eip155:8453', config)).toThrow(
      NonRoutableError
    )
    expect(() => determinePaymentRouting('eip155:8453', config)).toThrow(
      'cross-chain routing requires ALGORAND_MNEMONIC'
    )
  })

  it('rejects unsupported seller networks', () => {
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      mode: 'ALGORAND_ONLY'
    })

    expect(() => determinePaymentRouting('eip155:1', config)).toThrowError(
      /not supported/i
    )
  })
})
