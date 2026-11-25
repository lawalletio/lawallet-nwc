import { bech32m } from 'bech32'
import type { IntegrationId } from '@lawallet-nwc/shared'
import {
  DNS_INTEGRATION_IDS,
  SP_ENABLED_KEY,
  SP_PROVIDER_KEY
} from '@/lib/integrations/catalog'
import {
  cloudflareDns,
  vercelDns,
  type DnsProvider
} from '@/lib/integrations/dns-provider'
import { getIntegrationConfig } from '@/lib/integrations/server'
import { resolveAddressDomain } from '@/lib/public-url'
import { getSettings } from '@/lib/settings'
import { ConflictError, ValidationError } from '@/types/server/errors'

/**
 * BIP-353 silent payments: a BIP-352 `sp1…` address published as the TXT
 * record `<user>.user._bitcoin-payment.<domain>` = `bitcoin:?sp=<address>`.
 */

/** Validates a BIP-352 v0 address and returns it lowercased. */
export function parseSilentPaymentAddress(input: string): string {
  const addr = input.trim().toLowerCase()
  try {
    const { prefix, words } = bech32m.decode(addr, 1023)
    if (prefix !== 'sp' && prefix !== 'tsp') throw new Error('prefix')
    // v0: version word 0 ("q") + scan pubkey (33) + spend pubkey (33).
    if (words[0] !== 0) throw new Error('version')
    if (bech32m.fromWords(words.slice(1)).length !== 66) throw new Error('len')
  } catch {
    throw new ValidationError('Not a valid silent payment address (sp1q…)')
  }
  return addr
}

export const bip353Name = (username: string, domain: string) =>
  `${username}.user._bitcoin-payment.${domain}`

export const bip353Value = (sp: string) => `bitcoin:?sp=${sp}`

/** DNS needs the bare host: drop any `:port` from the address domain. */
const dnsDomain = (host: string) => host.replace(/:\d+$/, '').toLowerCase()

function isDnsIntegration(id: string | undefined): id is IntegrationId {
  return DNS_INTEGRATION_IDS.includes(id as IntegrationId)
}

/** The configured provider, or null when the feature is off/unusable. */
export async function getActiveDnsProvider(): Promise<DnsProvider | null> {
  const s = await getSettings([SP_ENABLED_KEY, SP_PROVIDER_KEY], {
    cache: 'hot'
  })
  const id = s[SP_PROVIDER_KEY]
  if (s[SP_ENABLED_KEY] !== 'true' || !isDnsIntegration(id)) return null
  const cfg = await getIntegrationConfig(id)
  if (!cfg.enabled || !cfg.configured) return null
  return buildDnsProvider(id, cfg.values)
}

export async function buildDnsProvider(
  id: IntegrationId,
  v: Record<string, string>
): Promise<DnsProvider> {
  if (id === 'cloudflare_dns') {
    return cloudflareDns({
      token: v.cloudflare_dns_token,
      zoneId: v.cloudflare_dns_zone_id
    })
  }
  return vercelDns({
    token: v.vercel_dns_token,
    teamId: v.vercel_dns_team_id,
    zone: v.vercel_dns_zone || dnsDomain(await resolveAddressDomain())
  })
}

export async function isSilentPaymentsActive(): Promise<boolean> {
  return (await getActiveDnsProvider()) !== null
}

async function requireProvider(): Promise<DnsProvider> {
  const provider = await getActiveDnsProvider()
  if (!provider) {
    throw new ConflictError('Silent payments are not enabled on this server')
  }
  return provider
}

export async function publishSilentPayment(
  username: string,
  sp: string
): Promise<void> {
  const provider = await requireProvider()
  const domain = dnsDomain(await resolveAddressDomain())
  await provider.setTxt(bip353Name(username, domain), bip353Value(sp))
}

export async function unpublishSilentPayment(username: string): Promise<void> {
  const provider = await requireProvider()
  const domain = dnsDomain(await resolveAddressDomain())
  await provider.deleteTxt(bip353Name(username, domain))
}
