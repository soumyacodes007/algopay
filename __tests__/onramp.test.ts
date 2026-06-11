import { describe, it, expect, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  DEFAULT_APP_ID,
  ONRAMP_WIDGET_URI,
  buildWidgetHtml,
  registerOnrampTool
} from '../src/tools/onramp.js'

function extractToolHandler(
  server: McpServer
): (...args: unknown[]) => Promise<unknown> {
  const calls = vi.mocked(server.registerTool).mock.calls
  const call = calls.find(c => c[0] === 'open_onramp')
  return call![2] as (...args: unknown[]) => Promise<unknown>
}

function extractResourceHandler(
  server: McpServer
): (...args: unknown[]) => Promise<unknown> {
  const calls = vi.mocked(server.registerResource).mock.calls
  const call = calls.find(c => c[0] === 'Onramp checkout widget')
  return call![3] as (...args: unknown[]) => Promise<unknown>
}

describe('onramp widget tool', () => {
  it('registers both the resource and the tool', () => {
    const server = {
      registerTool: vi.fn(),
      registerResource: vi.fn()
    } as unknown as McpServer

    registerOnrampTool(server)

    expect(server.registerResource).toHaveBeenCalledWith(
      'Onramp checkout widget',
      ONRAMP_WIDGET_URI,
      expect.objectContaining({
        mimeType: expect.stringContaining('text/html')
      }),
      expect.any(Function)
    )

    expect(server.registerTool).toHaveBeenCalledWith(
      'open_onramp',
      expect.objectContaining({
        description: expect.stringContaining('Onramp.money')
      }),
      expect.any(Function)
    )
  })

  it('returns a hosted browser URL payload for the configured flow', async () => {
    const server = {
      registerTool: vi.fn(),
      registerResource: vi.fn()
    } as unknown as McpServer

    registerOnrampTool(server)
    const handler = extractToolHandler(server)
    const result = (await handler({
      mode: 'buy',
      app_id: DEFAULT_APP_ID,
      sandbox: true,
      coin_code: 'algo',
      network: 'algo',
      fiat_amount: 100,
      lang: 'en'
    })) as {
      content: { text: string }[]
      structuredContent: {
        payload: {
          appId: number
          sandbox: boolean
          mode: string
          hostedUrl: string
        }
      }
    }

    expect(result.structuredContent.payload.appId).toBe(DEFAULT_APP_ID)
    expect(result.structuredContent.payload.sandbox).toBe(true)
    expect(result.structuredContent.payload.mode).toBe('buy')
    expect(result.structuredContent.payload.hostedUrl).toContain(
      'https://on-ramp-hosting.vercel.app/'
    )
    expect(result.content[0].text).toContain(
      'External Onramp browser flow ready.'
    )
  })

  it('rejects conflicting fiat and coin amount prefills', async () => {
    const server = {
      registerTool: vi.fn(),
      registerResource: vi.fn()
    } as unknown as McpServer

    registerOnrampTool(server)
    const handler = extractToolHandler(server)
    const result = (await handler({
      fiat_amount: 100,
      coin_amount: 2
    })) as {
      isError: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain(
      'provide either fiat_amount or coin_amount'
    )
  })

  it('builds HTML for the external browser launcher flow', () => {
    const html = buildWidgetHtml()

    expect(html).toContain('Move Money Seamlessly')
    expect(html).toContain('Open Secure Onramp in Browser')
    expect(html).toContain('Browser launch flow')
    expect(html).toContain('app.openLink')
  })

  it('serves resource HTML with browser-launch CSP metadata', async () => {
    const server = {
      registerTool: vi.fn(),
      registerResource: vi.fn()
    } as unknown as McpServer

    registerOnrampTool(server)
    const resourceHandler = extractResourceHandler(server)
    const result = (await resourceHandler()) as {
      contents: Array<{
        mimeType: string
        text: string
        _meta: {
          ui: {
            csp: {
              connectDomains: string[]
              resourceDomains: string[]
            }
          }
        }
      }>
    }

    expect(result.contents[0].mimeType).toContain('text/html')
    expect(result.contents[0].text).toContain('Open Secure Onramp in Browser')
    expect(result.contents[0]._meta.ui.csp.connectDomains).toContain(
      'https://api.onramp.money'
    )
    expect(result.contents[0]._meta.ui.csp.resourceDomains).toContain(
      'https://on-ramp-hosting.vercel.app/'
    )
  })
})
