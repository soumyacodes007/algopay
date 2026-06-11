import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AppConfig } from '@/types.js'
import { SpendingTracker } from '@/spending.js'
import { registerCheckBalance } from '@/tools/check-balance.js'
import { registerPay } from '@/tools/pay.js'
import { registerX402Fetch } from '@/tools/x402-fetch.js'
import { registerTransferUsdc } from '@/tools/transfer-usdc.js'
import { registerTransferAlgo } from '@/tools/transfer-algo.js'
import { registerTinymanSwaps } from '@/tools/tinyman-swap.js'
import { registerBazaarSearch } from '@/tools/bazaar-search.js'
import { registerRequestFunding } from '@/tools/request-funding.js'
import { registerSpendingReport } from '@/tools/spending-report.js'
import { registerCreateToken } from '@/tools/create-token.js'
import { registerOnrampTool } from '@/tools/onramp.js'
import { registerPeraRekeyTool } from '@/tools/rekey-pera.js'
import {
  EXTENSION_ID,
  RESOURCE_MIME_TYPE
} from '@modelcontextprotocol/ext-apps/server'

export function createMcpServer(config: AppConfig): McpServer {
  const server = new McpServer(
    {
      name: 'x402-wallet',
      version: '0.2.3'
    },
    {
      capabilities: {
        extensions: {
          [EXTENSION_ID]: {
            mimeTypes: [RESOURCE_MIME_TYPE]
          }
        }
      }
    }
  )

  const spending = new SpendingTracker(config.budget)

  // Core wallet - Algorand only
  registerCheckBalance(server, config)
  registerTransferUsdc(server, config, spending)
  registerTransferAlgo(server, config)

  // x402 Payments
  registerPay(server, config, spending)
  registerX402Fetch(server, config, spending)

  // Budget & Funding
  registerSpendingReport(server, spending)
  registerRequestFunding(server, config)

  // DeFi / DEX
  registerTinymanSwaps(server, config)

  // Token Creation
  registerCreateToken(server, config)

  // Discovery
  registerBazaarSearch(server)
  registerOnrampTool(server)
  registerPeraRekeyTool(server)

  return server
}
