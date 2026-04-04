/**
 * search_bazaar tool — query GoPlausible Bazaar for x402-gated API services.
 * Lets the agent discover what AI tools / APIs are available to pay for.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const BAZAAR_BASE = 'https://facilitator.goplausible.xyz'

export function registerBazaarSearch(server: McpServer): void {
  server.tool(
    'search_bazaar',
    'Search the GoPlausible Bazaar to discover x402-gated API services that agents can autonomously pay for. ' +
      'Returns a list of registered services with their endpoints, prices, and descriptions.',
    {
      query: z
        .string()
        .optional()
        .describe('Optional keyword to filter results (e.g. "weather", "llm", "image")'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe('Maximum number of results to return (default 20)')
    },
    async ({ query, limit }) => {
      try {
        const params = new URLSearchParams({ limit: String(limit) })
        if (query) params.append('q', query)

        const url = `${BAZAAR_BASE}/discovery/resources?${params.toString()}`
        const res = await fetch(url, { headers: { Accept: 'application/json' } })

        if (!res.ok) {
          throw new Error(`Bazaar API returned ${res.status}: ${await res.text()}`)
        }

        const data = (await res.json()) as any
        const items: any[] = data.items ?? data.resources ?? []

        if (items.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: query
                  ? `No services found matching "${query}" in the Bazaar.`
                  : 'The Bazaar is currently empty. Services appear here after their first successful x402 payment.'
              }
            ]
          }
        }

        // Optionally filter by query on our side too (in case the API doesn't support ?q=)
        const filtered = query
          ? items.filter((item: any) => {
              const haystack = JSON.stringify(item).toLowerCase()
              return haystack.includes(query.toLowerCase())
            })
          : items

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  total: data.pagination?.total ?? filtered.length,
                  showing: filtered.length,
                  services: filtered.map((item: any) => ({
                    endpoint: item.resource ?? item.url,
                    description: item.metadata?.description ?? item.description ?? null,
                    price: item.metadata?.price ?? item.price ?? null,
                    network: item.metadata?.network ?? item.network ?? 'algorand-testnet',
                    tags: item.metadata?.tags ?? item.tags ?? []
                  }))
                },
                null,
                2
              )
            }
          ]
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Bazaar search failed: ${err instanceof Error ? err.message : String(err)}`
            }
          ],
          isError: true
        }
      }
    }
  )
}
