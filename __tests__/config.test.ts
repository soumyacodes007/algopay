import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadConfig } from '../src/config.js'

vi.mock('../src/wallet-store.js', () => ({
  loadWalletConfig: vi.fn(() => null)
}))

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env.STELLAR_SECRET
    delete process.env.EVM_PRIVATE_KEY
    delete process.env.ALGORAND_MNEMONIC
    delete process.env.NETWORK
    delete process.env.MAX_PER_CALL
    delete process.env.MAX_PER_DAY
  })

  it('returns READ_ONLY when no keys are set', () => {
    const config = loadConfig()
    expect(config.mode).toBe('READ_ONLY')
    expect(config.canPay).toBe(false)
    expect(config.canPayStellar).toBe(false)
    expect(config.canPayEvm).toBe(false)
    expect(config.canPayAlgorand).toBe(false)
  })

  it('returns STELLAR_ONLY when only stellar key is set', () => {
    process.env.STELLAR_SECRET = 'STEST...'
    const config = loadConfig()
    expect(config.mode).toBe('STELLAR_ONLY')
    expect(config.canPay).toBe(true)
    expect(config.canPayStellar).toBe(true)
    expect(config.canPayEvm).toBe(false)
    expect(config.canPayAlgorand).toBe(false)
  })

  it('returns EVM_ONLY when only evm key is set', () => {
    process.env.EVM_PRIVATE_KEY = '0xabc123'
    const config = loadConfig()
    expect(config.mode).toBe('EVM_ONLY')
    expect(config.canPay).toBe(true)
    expect(config.canPayStellar).toBe(false)
    expect(config.canPayEvm).toBe(true)
    expect(config.canPayAlgorand).toBe(false)
  })

  it('returns ALGORAND_ONLY when only algorand mnemonic is set', () => {
    process.env.ALGORAND_MNEMONIC = 'mnemonic words...'
    const config = loadConfig()
    expect(config.mode).toBe('ALGORAND_ONLY')
    expect(config.canPay).toBe(true)
    expect(config.canPayStellar).toBe(false)
    expect(config.canPayEvm).toBe(false)
    expect(config.canPayAlgorand).toBe(true)
  })

  it('returns FULL when more than one signing capability is set', () => {
    process.env.STELLAR_SECRET = 'STEST...'
    process.env.ALGORAND_MNEMONIC = 'mnemonic words...'
    const config = loadConfig()
    expect(config.mode).toBe('FULL')
    expect(config.canPay).toBe(true)
    expect(config.canPayStellar).toBe(true)
    expect(config.canPayAlgorand).toBe(true)
  })

  it('uses algorand-testnet as the default network', () => {
    const config = loadConfig()
    expect(config.network).toBe('algorand-testnet')
  })

  it('respects NETWORK env var', () => {
    process.env.NETWORK = 'base-sepolia'
    const config = loadConfig()
    expect(config.network).toBe('base-sepolia')
  })

  it('uses default budget limits', () => {
    const config = loadConfig()
    expect(config.budget.maxPerCall).toBe('0.10')
    expect(config.budget.maxPerDay).toBe('20.00')
  })

  it('reload refreshes config after env changes', () => {
    const config = loadConfig()
    expect(config.mode).toBe('READ_ONLY')

    process.env.ALGORAND_MNEMONIC = 'mnemonic words...'
    config.reload()
    expect(config.mode).toBe('ALGORAND_ONLY')
    expect(config.canPayAlgorand).toBe(true)
  })
})
