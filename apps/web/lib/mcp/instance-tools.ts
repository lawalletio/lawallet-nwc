import packageJson from '@/package.json'
import { resolveAddressDomain } from '@/lib/public-url'
import { MCP_PATH, MCP_PUBLIC_PATH } from '@/lib/oauth/constants'
import { readSpendBudget } from '@/lib/mcp/wallet-tools'
import type { McpCaller, NativeTool } from '@/lib/mcp/types'

// The same figures wallet_pay_invoice and wallet_list_payments report.
async function spendBudget({ grant, scopes }: McpCaller) {
  if (!grant?.spendLimitSats || !scopes.has('spend')) return null
  return readSpendBudget(grant.id, grant.spendLimitSats)
}

/** Tools about the instance itself, served without a REST round-trip. */
export const instanceTools: NativeTool[] = [
  {
    name: 'get_instance_info',
    title: 'Instance info',
    description:
      'Describes this LaWallet instance — its URL, software version and the ' +
      'domain its lightning addresses use — and, when signed in, who you are ' +
      'connected as: pubkey, role, granted scopes and the remaining daily ' +
      'spend budget in sats. Call it first to orient yourself.',
    inputSchema: { type: 'object', properties: {} },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true
    },
    scope: 'public',
    handler: async (_args, caller) => ({
      instanceUrl: caller.apiUrl,
      mcpUrl: `${caller.apiUrl}${MCP_PATH}`,
      publicMcpUrl: `${caller.apiUrl}${MCP_PUBLIC_PATH}`,
      version: packageJson.version,
      addressDomain: await resolveAddressDomain(caller.request),
      connection: caller.user
        ? {
            pubkey: caller.user.pubkey,
            role: caller.user.role,
            scopes: [...caller.scopes],
            via: caller.grant ? 'oauth' : 'session token',
            clientName: caller.grant?.clientName ?? null,
            spendBudget: await spendBudget(caller)
          }
        : null
    })
  }
]
