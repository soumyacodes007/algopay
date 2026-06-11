import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { SpendingTracker } from '../src/spending.js'
import { registerPay } from '../src/tools/pay.js'

const mockCreatePaymentPayload = vi.fn()
const mockEncodePaymentSignatureHeader = vi.fn()

vi.mock('../src/clients.js', () => ({
  createHttpClient: vi.fn().mockResolvedValue({
    createPaymentPayload: (...args: unknown[]) =>
      mockCreatePaymentPayload(...args),
    encodePaymentSignatureHeader: (...args: unknown[]) =>
      mockEncodePaymentSignatureHeader(...args)
  }),
  getCaip2Network: vi.fn((net: string) => {
    const map: Record<string, string> = {
      stellar: 'stellar:pubnet',
      'stellar-testnet': 'stellar:testnet',
      base: 'eip155:8453',
      'base-sepolia': 'eip155:84532',
      algorand: 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
      'algorand-testnet':
        'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
    }
    return map[net]
  }),
  isStellarNetwork: vi.fn((net: string) => net.startsWith('stellar')),
  isEvmNetwork: vi.fn((net: string) => net.startsWith('base')),
  isAlgorandNetwork: vi.fn((net: string) => net.startsWith('algorand'))
}))

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
  const call = calls.find(c => c[0] === 'pay')
  return call![call!.length - 1] as (...args: unknown[]) => Promise<unknown>
}

describe('pay tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreatePaymentPayload.mockResolvedValue({
      x402Version: 2,
      payload: 'signed-data'
    })
    mockEncodePaymentSignatureHeader.mockReturnValue({
      'PAYMENT-SIGNATURE': 'base64-payment-header-value'
    })
  })

  it('registers the tool with correct name', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig()
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)
    expect(server.tool).toHaveBeenCalledWith(
      'pay',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns error when no wallet is configured', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({ canPay: false })
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: 'GABC...',
      network: 'stellar-testnet'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No wallet configured')
  })

  it('returns error when stellar key is missing for stellar payments', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayEvm: true,
      evmPrivateKey: '0xabc',
      mode: 'EVM_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: 'GABC...',
      network: 'stellar-testnet'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Stellar key not configured')
  })

  it('returns error when evm key is missing for base payments', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      mode: 'ALGORAND_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: '0xABC...',
      network: 'base-sepolia'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('EVM key not configured')
  })

  it('rejects a payment that exceeds the per-call budget', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayStellar: true,
      stellarSecret: 'STEST...',
      mode: 'STELLAR_ONLY',
      budget: { maxPerCall: '0.01', maxPerDay: '20.00' }
    })
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.50',
      recipient: 'GABC...',
      network: 'stellar-testnet'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('exceeds per-call limit')
  })

  it('returns a payment header and records spending on success', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayStellar: true,
      stellarSecret: 'STEST...',
      mode: 'STELLAR_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: 'GABC...',
      network: 'stellar-testnet',
      resource: 'https://api.example.com/data'
    })) as { content: { text: string }[] }

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.paymentHeader).toBe('base64-payment-header-value')
    expect(parsed.headerName).toBe('PAYMENT-SIGNATURE')
    expect(parsed.amount).toBe('0.05 USDC')
    expect(parsed.recipient).toBe('GABC...')
    expect(parsed.network).toBe('stellar-testnet')

    const summary = spending.getSummary()
    expect(parseFloat(summary.spentSession)).toBeCloseTo(0.05)
    expect(summary.recentPayments).toHaveLength(1)
  })

  it('includes eip-712 metadata for base sepolia payments', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayEvm: true,
      evmPrivateKey: '0xabc',
      mode: 'EVM_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({
      amount: '0.05',
      recipient: '0xRecipient',
      network: 'base-sepolia'
    })

    const paymentRequired = mockCreatePaymentPayload.mock.calls[0][0]
    expect(paymentRequired.accepts[0].extra).toEqual({
      name: 'USDC',
      version: '2'
    })
  })

  it('builds algorand payment requirements with an empty extra object', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      mode: 'ALGORAND_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    await handler({
      amount: '0.05',
      recipient: 'ALGORECIPIENT',
      network: 'algorand-testnet'
    })

    const paymentRequired = mockCreatePaymentPayload.mock.calls[0][0]
    expect(paymentRequired.accepts[0].network).toBe(
      'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
    )
    expect(paymentRequired.accepts[0].asset).toBe('10458941')
    expect(paymentRequired.accepts[0].extra).toEqual({})
  })

  it('does not record spending when signing fails', async () => {
    mockCreatePaymentPayload.mockRejectedValue(new Error('Signing failed'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayStellar: true,
      stellarSecret: 'STEST...',
      mode: 'STELLAR_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerPay(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      amount: '0.05',
      recipient: 'GABC...',
      network: 'stellar-testnet'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Signing failed')

    const summary = spending.getSummary()
    expect(parseFloat(summary.spentSession)).toBe(0)
    expect(summary.recentPayments).toHaveLength(0)
  })
})
