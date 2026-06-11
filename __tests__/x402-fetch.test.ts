import { describe, it, expect, vi, beforeEach } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '../src/types.js'
import { SpendingTracker } from '../src/spending.js'
import { registerX402Fetch } from '../src/tools/x402-fetch.js'

const mockCreatePaymentPayload = vi.fn()
const mockEncodePaymentSignatureHeader = vi.fn()
const mockSendToHub = vi.fn()
const mockGetWalletAddress = vi.fn()

vi.mock('../src/clients.js', () => ({
  createHttpClient: vi.fn().mockResolvedValue({
    createPaymentPayload: (...args: unknown[]) =>
      mockCreatePaymentPayload(...args),
    encodePaymentSignatureHeader: (...args: unknown[]) =>
      mockEncodePaymentSignatureHeader(...args)
  }),
  getWalletAddress: (...args: unknown[]) => mockGetWalletAddress(...args),
  isStellarNetwork: vi.fn((net: string) => net.startsWith('stellar'))
}))

vi.mock('../src/clients/hub-client.js', () => ({
  sendToHub: (...args: unknown[]) => mockSendToHub(...args)
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

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
  const call = calls.find(c => c[0] === 'x402_fetch')
  return call![call!.length - 1] as (...args: unknown[]) => Promise<unknown>
}

type ToolResult = {
  isError?: boolean
  content: { type: string; text: string }[]
}

function textResponse(status: number, body: string, statusText = 'OK') {
  return {
    status,
    statusText,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null
    },
    text: vi.fn().mockResolvedValue(body)
  }
}

describe('x402_fetch tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreatePaymentPayload.mockResolvedValue({ payload: 'signed' })
    mockEncodePaymentSignatureHeader.mockReturnValue({
      'PAYMENT-SIGNATURE': 'signed-header-value'
    })
    mockSendToHub.mockResolvedValue({
      success: true,
      paymentSignature: 'hub-signed-header',
      transactionId: 'TX-123'
    })
    mockGetWalletAddress.mockResolvedValue('ALGOADDR')
  })

  it('registers the tool with correct name', () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig()
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)
    expect(server.tool).toHaveBeenCalledWith(
      'x402_fetch',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    )
  })

  it('returns error when no wallet configured', async () => {
    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({ canPay: false })
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/data',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('No wallet configured')
  })

  it('returns a free response directly when the server does not require payment', async () => {
    mockFetch.mockResolvedValue(textResponse(200, '{"result":"success"}'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      mode: 'ALGORAND_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/free',
      method: 'GET'
    })) as ToolResult

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.status).toBe(200)
    expect(parsed.body).toBe('{"result":"success"}')
    expect(parsed.bodyEncoding).toBe('text')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('handles a native algorand x402 flow and retries with generated headers', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 402,
        statusText: 'Payment Required',
        headers: { get: () => null },
        json: vi.fn().mockResolvedValue({
          x402Version: 2,
          error: '',
          resource: { url: '', description: '', mimeType: '' },
          accepts: [
            {
              scheme: 'exact',
              network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
              asset: '10458941',
              amount: '50000',
              payTo: 'ALGOSELLER',
              maxTimeoutSeconds: 300,
              extra: {}
            }
          ]
        })
      })
      .mockResolvedValueOnce(textResponse(200, '{"paid":true}'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      mode: 'ALGORAND_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/native-paid',
      method: 'GET'
    })) as ToolResult

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.status).toBe(200)
    expect(parsed.payment.amount).toBe('0.050000 USDC')
    expect(parsed.payment.recipient).toBe('ALGOSELLER')
    expect(parsed.payment.network).toBe('algorand-testnet')
    expect(mockCreatePaymentPayload).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[1][1]?.headers?.['X-PAYMENT']).toBe(
      'signed-header-value'
    )
  })

  it('routes cross-chain payments through the hub and records spending', async () => {
    mockFetch
      .mockResolvedValueOnce({
        status: 402,
        statusText: 'Payment Required',
        headers: { get: () => null },
        json: vi.fn().mockResolvedValue({
          x402Version: 2,
          error: '',
          resource: { url: '', description: '', mimeType: '' },
          accepts: [
            {
              scheme: 'exact',
              network: 'eip155:84532',
              asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
              amount: '50000',
              payTo: '0xRecipient',
              maxTimeoutSeconds: 300,
              extra: {}
            }
          ]
        })
      })
      .mockResolvedValueOnce(textResponse(200, '{"ok":true}'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      mode: 'ALGORAND_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/hub-paid',
      method: 'GET'
    })) as ToolResult

    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.status).toBe(200)
    expect(parsed.payment.amount).toBe('0.050000 USDC (via Pixa Hub)')
    expect(parsed.payment.network).toBe('eip155:84532')
    expect(parsed.payment.transactionId).toBe('TX-123')
    expect(mockSendToHub).toHaveBeenCalledWith(
      expect.objectContaining({
        sellerNetwork: 'eip155:84532',
        userContext: expect.objectContaining({
          algorandAddress: 'ALGOADDR',
          maxDebitAtomic: '50000'
        })
      }),
      'mnemonic words...'
    )

    const summary = spending.getSummary()
    expect(parseFloat(summary.spentSession)).toBeCloseTo(0.05)
    expect(summary.recentPayments[0].recipient).toBe('0xRecipient')
  })

  it('returns an explicit error when a 402 response has no payment options', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue({
        x402Version: 2,
        error: '',
        resource: { url: '', description: '', mimeType: '' },
        accepts: []
      })
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      mode: 'ALGORAND_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('no payment options')
  })

  it('fails fast when a hub-routed seller is encountered without algorand funding configured', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue({
        x402Version: 2,
        error: '',
        resource: { url: '', description: '', mimeType: '' },
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:84532',
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            amount: '50000',
            payTo: '0xRecipient',
            maxTimeoutSeconds: 300,
            extra: {}
          }
        ]
      })
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayEvm: true,
      evmPrivateKey: '0xabc',
      mode: 'EVM_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/paid',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Payment routing failed')
    expect(result.content[0].text).toContain('ALGORAND_MNEMONIC')
  })

  it('enforces spending limits before sending a hub payment', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 402,
      statusText: 'Payment Required',
      headers: { get: () => null },
      json: vi.fn().mockResolvedValue({
        x402Version: 2,
        error: '',
        resource: { url: '', description: '', mimeType: '' },
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:84532',
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            amount: '5000000',
            payTo: '0xRecipient',
            maxTimeoutSeconds: 300,
            extra: {}
          }
        ]
      })
    })

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      budget: { maxPerCall: '1.00', maxPerDay: '20.00' },
      mode: 'ALGORAND_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/expensive',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('exceeds per-call limit')
    expect(mockSendToHub).not.toHaveBeenCalled()
  })

  it('handles fetch network failures gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const server = { tool: vi.fn() } as unknown as McpServer
    const config = makeConfig({
      canPay: true,
      canPayAlgorand: true,
      algorandMnemonic: 'mnemonic words...',
      mode: 'ALGORAND_ONLY'
    })
    const spending = new SpendingTracker(config.budget)
    registerX402Fetch(server, config, spending)

    const handler = extractToolHandler(server)
    const result = (await handler({
      url: 'https://api.example.com/down',
      method: 'GET'
    })) as ToolResult

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Network error')
  })
})
