import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const mockIsValidAddress = vi.fn()
const mockGetParams = vi.fn()
const mockMakePaymentTxn = vi.fn()
const mockEncodeUnsigned = vi.fn()

vi.mock('algosdk', () => ({
  default: {
    isValidAddress: (...args: unknown[]) => mockIsValidAddress(...args),
    Algodv2: vi.fn().mockImplementation(() => ({
      getTransactionParams: vi.fn(() => ({
        do: (...args: unknown[]) => mockGetParams(...args)
      }))
    })),
    makePaymentTxnWithSuggestedParamsFromObject: (...args: unknown[]) =>
      mockMakePaymentTxn(...args),
    encodeUnsignedTransaction: (...args: unknown[]) =>
      mockEncodeUnsigned(...args)
  }
}))

const { registerPeraRekeyTool } = await import('../src/tools/rekey-pera.js')

function extractToolHandler(
  server: McpServer
): (...args: unknown[]) => Promise<unknown> {
  const calls = vi.mocked(server.registerTool).mock.calls
  const call = calls.find(c => c[0] === 'rekey_with_pera')
  return call![2] as (...args: unknown[]) => Promise<unknown>
}

describe('rekey_with_pera tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsValidAddress.mockReturnValue(true)
    mockGetParams.mockResolvedValue({
      fee: 1000,
      firstValid: 100,
      lastValid: 200
    })
    mockMakePaymentTxn.mockReturnValue({
      fee: 1000,
      firstValid: 100,
      lastValid: 200
    })
    mockEncodeUnsigned.mockReturnValue(new Uint8Array([1, 2, 3, 4]))
  })

  it('registers the rekey tool', () => {
    const server = {
      registerTool: vi.fn(),
      registerResource: vi.fn()
    } as unknown as McpServer

    registerPeraRekeyTool(server)

    expect(server.registerTool).toHaveBeenCalledWith(
      'rekey_with_pera',
      expect.objectContaining({
        title: expect.stringContaining('Rekey')
      }),
      expect.any(Function)
    )
  })

  it('rejects invalid source addresses before building a transaction', async () => {
    mockIsValidAddress.mockReturnValueOnce(false)

    const server = {
      registerTool: vi.fn(),
      registerResource: vi.fn()
    } as unknown as McpServer
    registerPeraRekeyTool(server)

    const handler = extractToolHandler(server)
    const result = (await handler({
      wallet_address: 'bad-address',
      new_auth_address: 'VALIDADDR',
      network: 'algorand-testnet'
    })) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Invalid wallet_address')
    expect(mockGetParams).not.toHaveBeenCalled()
  })

  it('returns a structured rekey payload for valid requests', async () => {
    const server = {
      registerTool: vi.fn(),
      registerResource: vi.fn()
    } as unknown as McpServer
    registerPeraRekeyTool(server)

    const handler = extractToolHandler(server)
    const result = (await handler({
      wallet_address: 'SOURCEADDR',
      new_auth_address: 'TARGETADDR',
      network: 'algorand-testnet',
      note: 'session rekey'
    })) as {
      content: { text: string }[]
      structuredContent: {
        payload: {
          sourceAddress: string
          newAuthAddress: string
          network: string
          unsignedTxnBase64: string
          feeMicroAlgos: number
          validRoundFirst: number
          validRoundLast: number
        }
      }
    }

    expect(result.content[0].text).toContain(
      'Pera rekey approval request ready.'
    )
    expect(result.structuredContent.payload.sourceAddress).toBe('SOURCEADDR')
    expect(result.structuredContent.payload.newAuthAddress).toBe('TARGETADDR')
    expect(result.structuredContent.payload.network).toBe('algorand-testnet')
    expect(result.structuredContent.payload.feeMicroAlgos).toBe(1000)
    expect(result.structuredContent.payload.validRoundFirst).toBe(100)
    expect(result.structuredContent.payload.validRoundLast).toBe(200)
    expect(result.structuredContent.payload.unsignedTxnBase64).toBe(
      Buffer.from([1, 2, 3, 4]).toString('base64')
    )
    expect(mockMakePaymentTxn).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: 'SOURCEADDR',
        receiver: 'SOURCEADDR',
        amount: 0,
        rekeyTo: 'TARGETADDR'
      })
    )
  })
})
