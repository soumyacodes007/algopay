import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { registerCheckBalance } from '../src/tools/check-balance.js'

vi.mock('../src/clients.js', () => ({
  getWalletAddress: vi.fn(),
  getUsdcBalance: vi.fn(),
  isAlgorandNetwork: vi.fn((network: string) => network.startsWith('algorand'))
}))

vi.mock('algosdk', () => ({
  default: {
    Algodv2: vi.fn().mockImplementation(() => ({
      accountInformation: vi.fn(() => ({
        do: vi.fn().mockResolvedValue({ amount: 1_250_000 })
      }))
    }))
  }
}))

import { getWalletAddress, getUsdcBalance } from '../src/clients.js'

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

function extractToolHandler(
  server: McpServer
): (...args: unknown[]) => Promise<unknown> {
  const calls = vi.mocked(server.tool).mock.calls
  const call = calls.find(c => c[0] === 'check_balance')
  return call![call!.length - 1] as (...args: unknown[]) => Promise<unknown>
}

describe('check_balance tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the tool with correct name', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig()
    registerCheckBalance(server, config)
    expect(server.tool).toHaveBeenCalledWith(
      'check_balance',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns error when no wallet configured', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({ canPay: false })
    registerCheckBalance(server, config)

    const handler = extractToolHandler(server)
    const result = (await handler({})) as {
      isError: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No wallet configured')
  })

  it('returns EVM wallet balance payload on success', async () => {
    vi.mocked(getWalletAddress).mockResolvedValue('0xabc123')
    vi.mocked(getUsdcBalance).mockResolvedValue('100.500000')

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayEvm: true,
      evmPrivateKey: '0xprivate',
      network: 'base-sepolia',
      mode: 'EVM_ONLY'
    })
    registerCheckBalance(server, config)

    const handler = extractToolHandler(server)
    const result = (await handler({})) as { content: { text: string }[] }

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.address).toBe('0xabc123')
    expect(parsed.usdc).toBe('100.500000 USDC')
    expect(parsed.network).toBe('base-sepolia')
    expect(parsed.mode).toBe('EVM_ONLY')
    expect(parsed.algo).toBeUndefined()
  })

  it('includes algo balance for algorand wallets', async () => {
    vi.mocked(getWalletAddress).mockResolvedValue('ALGOADDR')
    vi.mocked(getUsdcBalance).mockResolvedValue('42.000000')

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      network: 'algorand-testnet',
      mode: 'ALGORAND_ONLY'
    })
    registerCheckBalance(server, config)

    const handler = extractToolHandler(server)
    const result = (await handler({})) as { content: { text: string }[] }

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.address).toBe('ALGOADDR')
    expect(parsed.usdc).toBe('42.000000 USDC')
    expect(parsed.algo).toBe('1.250000 ALGO')
    expect(parsed.swapNote).toContain('Tinyman swaps')
  })

  it('returns error when balance fetch fails', async () => {
    vi.mocked(getWalletAddress).mockRejectedValue(new Error('Network error'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...'
    })
    registerCheckBalance(server, config)

    const handler = extractToolHandler(server)
    const result = (await handler({})) as {
      isError: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Network error')
  })
})
