import type { IntegrationId } from '@lawallet-nwc/shared'

/**
 * Third-party integrations an admin can switch on. Client-safe metadata only:
 * the admin page renders its form from `fields`, the server reads/writes the
 * same flat Settings keys (`<id>_enabled` + each field key, all ≤ 32 chars).
 */

export interface IntegrationField {
  /** Settings key. */
  key: string
  label: string
  /** Write-only: encrypted at rest, never returned to any client. */
  secret?: boolean
  /** Must be set for the integration to count as configured. */
  required?: boolean
  /** Used when the key is unset. */
  defaultValue?: string
  placeholder?: string
  help?: string
}

export interface IntegrationMeta {
  id: IntegrationId
  name: string
  description: string
  kind: 'swap' | 'lookup'
  website: string
  fields: IntegrationField[]
}

export const INTEGRATIONS: Record<IntegrationId, IntegrationMeta> = {
  bullbitcoin: {
    id: 'bullbitcoin',
    name: 'Bull Bitcoin',
    description:
      'Cash out Lightning sats to any Argentine bank account (CBU/CVU) in ARS, through the community’s Bull Bitcoin account.',
    kind: 'swap',
    website: 'https://www.bullbitcoin.com',
    fields: [
      {
        key: 'bullbitcoin_api_key',
        label: 'API key',
        secret: true,
        required: true,
        placeholder: 'Paste the Bull Bitcoin API key',
        help: 'Mint it while logged in at app.bullbitcoin.com: POST https://accounts.bullbitcoin.com/api/generate-api-key with your bb_session cookie and {"apiKeyName":"lawallet"}. See docs/integrations/THIRD-PARTY.md.'
      }
    ]
  },
  wapu: {
    id: 'wapu',
    name: 'Wapu',
    description:
      'Cash out Lightning sats to any Argentine bank account or alias in ARS, through the community’s Wapu account.',
    kind: 'swap',
    website: 'https://wapu.app',
    fields: [
      {
        key: 'wapu_api_key',
        label: 'API key',
        secret: true,
        required: true,
        placeholder: 'Paste the Wapu API key',
        help: 'Wapu’s firewall blocks datacenter IPs (Vercel/AWS) until Wapu allowlists your server — use Test to check.'
      }
    ]
  },
  alias: {
    id: 'alias',
    name: 'Gorilla API (alias lookup)',
    description:
      'Resolve an Argentine bank ALIAS, CBU or CVU to its owner name and bank, so users can confirm who they are paying.',
    kind: 'lookup',
    website: 'https://github.com/agustinkassis/gorilla-api',
    fields: [
      {
        key: 'alias_api_url',
        label: 'API URL',
        defaultValue: 'https://api.masize.com',
        placeholder: 'https://api.masize.com',
        help: 'Base URL of a gorilla-api deployment.'
      }
    ]
  }
}

export const INTEGRATION_IDS = Object.keys(INTEGRATIONS) as IntegrationId[]

export const INTEGRATION_SECRET_KEYS = Object.values(INTEGRATIONS).flatMap(i =>
  i.fields.filter(f => f.secret).map(f => f.key)
)

export const enabledKey = (id: IntegrationId) => `${id}_enabled`

/** Public `/api/settings` flag the wallet + Android read: `integration_<id>`. */
export const availableFlag = (id: IntegrationId) => `integration_${id}`
