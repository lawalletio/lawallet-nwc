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
  kind: 'swap' | 'lookup' | 'dns'
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
  },
  vercel_dns: {
    id: 'vercel_dns',
    name: 'Vercel DNS',
    description:
      'Publish BIP-353 silent payment records (₿user@domain) as TXT records in a domain managed by Vercel DNS.',
    kind: 'dns',
    website: 'https://vercel.com/docs/domains/managing-dns-records',
    fields: [
      {
        key: 'vercel_dns_token',
        label: 'API token',
        secret: true,
        required: true,
        placeholder: 'Paste a Vercel access token',
        help: 'Create it at vercel.com/account/tokens, scoped to the team that owns the domain. Vercel DNS does not sign zones with DNSSEC, which BIP-353 requires — strict wallets may reject these records.'
      },
      {
        key: 'vercel_dns_team_id',
        label: 'Team ID',
        placeholder: 'team_…',
        help: 'Only needed when the domain belongs to a team.'
      },
      {
        key: 'vercel_dns_zone',
        label: 'Zone domain',
        placeholder: 'example.com',
        help: 'The domain as registered in Vercel. Leave blank to use the instance domain; set it when the instance runs on a subdomain.'
      }
    ]
  },
  cloudflare_dns: {
    id: 'cloudflare_dns',
    name: 'Cloudflare DNS',
    description:
      'Publish BIP-353 silent payment records (₿user@domain) as TXT records in a Cloudflare zone. Enable DNSSEC on the zone.',
    kind: 'dns',
    website: 'https://developers.cloudflare.com/dns/',
    fields: [
      {
        key: 'cloudflare_dns_token',
        label: 'API token',
        secret: true,
        required: true,
        placeholder: 'Paste a Cloudflare API token',
        help: 'Create it at dash.cloudflare.com/profile/api-tokens with Zone → DNS → Edit (and DNS Settings → Read for the DNSSEC check), limited to this zone.'
      },
      {
        key: 'cloudflare_dns_zone_id',
        label: 'Zone ID',
        required: true,
        placeholder: '32-character zone ID',
        help: 'Shown on the zone’s Overview page in the Cloudflare dashboard.'
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

/** Integrations that can publish BIP-353 TXT records. */
export const DNS_INTEGRATION_IDS = INTEGRATION_IDS.filter(
  id => INTEGRATIONS[id].kind === 'dns'
)

/** Settings keys for the BIP-353 silent payments feature. */
export const SP_ENABLED_KEY = 'silent_payments_enabled'
export const SP_PROVIDER_KEY = 'silent_payments_dns_provider'
