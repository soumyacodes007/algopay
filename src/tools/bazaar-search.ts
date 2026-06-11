/**
 * search_bazaar tool — query the real CDP x402 Bazaar.
 * If a query is provided, it uses CDP's semantic search endpoint.
 * Otherwise it browses the latest indexed resources.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const CDP_BAZAAR_BASE =
  'https://api.cdp.coinbase.com/platform/v2/x402/discovery'
const DEFAULT_NETWORK = 'base-sepolia'
const DEFAULT_LIMIT = 10
const DEFAULT_MAX_USD_PRICE = 0.05
const NETWORK_ALIASES: Record<string, string[]> = {
  'base-sepolia': ['base-sepolia', 'eip155:84532'],
  'eip155:84532': ['eip155:84532', 'base-sepolia'],
  base: ['base', 'base-mainnet', 'eip155:8453'],
  'base-mainnet': ['base-mainnet', 'base', 'eip155:8453'],
  'eip155:8453': ['eip155:8453', 'base', 'base-mainnet']
}

type BazaarAccept = {
  amount?: string
  asset?: string
  description?: string
  maxAmountRequired?: string
  network?: string
  payTo?: string
  outputSchema?: {
    input?: {
      method?: string
      type?: string
    }
  }
  extra?: {
    name?: string
    version?: string
  }
}

type BazaarResource = {
  accepts?: BazaarAccept[]
  description?: string
  lastUpdated?: string
  resource: string
  type?: string
  x402Version?: number
  outputSchema?: {
    input?: {
      method?: string
      type?: string
    }
  }
}

type BazaarResponse = {
  items?: BazaarResource[]
  partialResults?: boolean
  pagination?: {
    limit?: number
    offset?: number
    total?: number
  }
  resources?: BazaarResource[]
  searchMethod?: string
  x402Version?: number
}

function normalizeNetwork(value?: string): string {
  return value?.trim() || DEFAULT_NETWORK
}

function getMethod(resource: BazaarResource): string | undefined {
  return (
    resource.outputSchema?.input?.method ||
    resource.accepts?.find(accept => accept.outputSchema?.input?.method)
      ?.outputSchema?.input?.method
  )
}

function getPrimaryDescription(resource: BazaarResource): string {
  return (
    resource.description ||
    resource.accepts?.find(accept => accept.description)?.description ||
    'No description provided.'
  )
}

function getNetworks(resource: BazaarResource): string[] {
  return [
    ...new Set(
      (resource.accepts ?? [])
        .map(accept => accept.network)
        .filter(Boolean) as string[]
    )
  ]
}

function formatPriceAtomic(value?: string, tokenName?: string): string {
  if (!value) return 'Unknown'

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return value

  const maybeStable =
    !tokenName ||
    /(usdc|usd coin|global dollar|euro coin|eurc|pyusd|usd)/i.test(tokenName)

  if (!maybeStable) return value

  return `$${(parsed / 1_000_000).toFixed(6)}`
}

function getPriceSummary(resource: BazaarResource): string {
  const accepts = resource.accepts ?? []
  if (accepts.length === 0) return 'Unknown'

  const parts = accepts.map(accept => {
    const rawAmount = accept.amount ?? accept.maxAmountRequired
    const tokenName = accept.extra?.name
    const amountLabel = formatPriceAtomic(rawAmount, tokenName)
    const network = accept.network ?? 'unknown-network'
    return `${amountLabel} on ${network}`
  })

  return [...new Set(parts)].join(' | ')
}

function withinMaxPrice(
  resource: BazaarResource,
  maxUsdPrice: number
): boolean {
  const accepts = resource.accepts ?? []
  if (accepts.length === 0) return true

  return accepts.some(accept => {
    const rawAmount = accept.amount ?? accept.maxAmountRequired
    if (!rawAmount) return true

    const parsed = Number(rawAmount)
    if (!Number.isFinite(parsed)) return true

    return parsed / 1_000_000 <= maxUsdPrice
  })
}

function matchesNetwork(resource: BazaarResource, network: string): boolean {
  const networks = getNetworks(resource)
  if (networks.length === 0) return true

  const requested = network.toLowerCase()
  const aliases = NETWORK_ALIASES[requested] ?? [requested]

  return networks.some(value => aliases.includes(value.toLowerCase()))
}

function formatResource(resource: BazaarResource, index: number): string {
  const primaryAccept = resource.accepts?.[0]
  const method = getMethod(resource)
  const description = getPrimaryDescription(resource)
  const networks = getNetworks(resource)
  const payTo = primaryAccept?.payTo
  const price = getPriceSummary(resource)

  const lines = [
    `${index + 1}. ${description}`,
    `   Resource: ${resource.resource}`,
    `   Price: ${price}`,
    `   x402: v${resource.x402Version ?? 'unknown'}`
  ]

  if (method) lines.push(`   Method: ${method}`)
  if (networks.length > 0) lines.push(`   Networks: ${networks.join(', ')}`)
  if (payTo) lines.push(`   Pay to: ${payTo}`)
  if (resource.lastUpdated) lines.push(`   Updated: ${resource.lastUpdated}`)

  return lines.join('\n')
}

async function fetchBazaarResourcesFiltered(
  query: string | undefined,
  network: string,
  maxUsdPrice: number
): Promise<BazaarResponse> {
  const url = new URL(
    query ? `${CDP_BAZAAR_BASE}/search` : `${CDP_BAZAAR_BASE}/resources`
  )

  if (query) url.searchParams.set('query', query)
  if (network) url.searchParams.set('network', network)
  if (maxUsdPrice > 0)
    url.searchParams.set('maxUsdPrice', maxUsdPrice.toString())

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json'
    }
  })

  if (!res.ok) {
    throw new Error(`CDP Bazaar returned ${res.status}: ${await res.text()}`)
  }

  return (await res.json()) as BazaarResponse
}

export function registerBazaarSearch(server: McpServer): void {
  server.tool(
    'search_bazaar',
    'Search the real CDP x402 Bazaar to discover paywalled APIs and agent services. ' +
      'Uses CDP semantic search when you provide a query, and browse mode when you do not.',
    {
      query: z
        .string()
        .optional()
        .describe(
          'Optional natural-language query, like "pizza", "weather", "scraping", or "image generation".'
        ),
      network: z
        .string()
        .optional()
        .default(DEFAULT_NETWORK)
        .describe(
          'Optional payment network filter, like "base-sepolia", "eip155:84532", or "base".'
        ),
      max_usd_price: z
        .number()
        .positive()
        .optional()
        .default(DEFAULT_MAX_USD_PRICE)
        .describe(
          'Optional maximum price filter in USD-equivalent, applied locally after fetching results.'
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(DEFAULT_LIMIT)
        .describe('Maximum number of results to return.')
    },
    async ({ query, network, max_usd_price, limit }) => {
      try {
        const requestedNetwork = normalizeNetwork(network)
        const data = await fetchBazaarResourcesFiltered(
          query,
          requestedNetwork,
          max_usd_price
        )
        const resources = data.resources ?? data.items ?? []

        const filtered = resources
          .filter(resource => matchesNetwork(resource, requestedNetwork))
          .filter(resource => withinMaxPrice(resource, max_usd_price))
          .slice(0, limit)

        if (filtered.length === 0) {
          const mode = query ? `semantic search for "${query}"` : 'browse mode'

          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `No Bazaar resources found for ${mode} ` +
                  `with network "${requestedNetwork}" and max price $${max_usd_price.toFixed(2)}.`
              }
            ]
          }
        }

        const mode = query
          ? `CDP Bazaar semantic search for "${query}"`
          : 'CDP Bazaar browse mode'

        const headerLines = [
          `${mode} returned ${filtered.length} result(s).`,
          `Network filter: ${requestedNetwork}`,
          `Max price filter: $${max_usd_price.toFixed(2)}`
        ]

        if (data.searchMethod) {
          headerLines.push(`Search method: ${data.searchMethod}`)
        }

        if (data.partialResults) {
          headerLines.push('Partial results: true')
        }

        const body = filtered.map(formatResource).join('\n\n')

        return {
          content: [
            {
              type: 'text' as const,
              text: `${headerLines.join('\n')}\n\n${body}`
            }
          ]
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `CDP Bazaar search failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
