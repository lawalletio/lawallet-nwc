import type { IntegrationId } from '@lawallet-nwc/shared'
import { getConfig } from '@/lib/config'
import { getSettings } from '@/lib/settings'
import {
  decryptNwcVaultEnvelope,
  encryptNwcVaultEnvelope
} from '@/lib/wallet/remote-wallet-vault-core'
import {
  INTEGRATIONS,
  INTEGRATION_IDS,
  availableFlag,
  enabledKey
} from './catalog'

/** AAD record id for secrets stored in the Settings table. */
const RECORD_ID = 'settings'

type SettingsMap = Record<string, string | undefined>

export interface IntegrationConfig {
  enabled: boolean
  configured: boolean
  /** Field values with defaults applied and secrets decrypted. */
  values: Record<string, string>
}

export function integrationSettingsKeys(id: IntegrationId): string[] {
  return [enabledKey(id), ...INTEGRATIONS[id].fields.map(f => f.key)]
}

const ALL_KEYS = INTEGRATION_IDS.flatMap(integrationSettingsKeys)

/** Configured = every required field has a stored value (defaults count). */
export function isConfigured(id: IntegrationId, s: SettingsMap): boolean {
  return INTEGRATIONS[id].fields.every(
    f => !f.required || Boolean(s[f.key] || f.defaultValue)
  )
}

export function isAvailable(id: IntegrationId, s: SettingsMap): boolean {
  return s[enabledKey(id)] === 'true' && isConfigured(id, s)
}

/**
 * Secrets are sealed with NWC_VAULT_SECRET when it is set (AAD binds the
 * value to its Settings key). Without it they are stored as-is, write-only,
 * the same as the email provider credentials.
 */
export function sealSecret(key: string, plaintext: string): string {
  const secret = getConfig(false).nwcVault?.secret
  return secret
    ? encryptNwcVaultEnvelope(plaintext, RECORD_ID, key, secret)
    : plaintext
}

function openSecret(key: string, stored: string): string {
  // Passes plaintext (pre-vault or vault-less installs) straight through.
  return decryptNwcVaultEnvelope(
    stored,
    RECORD_ID,
    key,
    getConfig(false).nwcVault?.secret
  )
}

export function resolveIntegration(
  id: IntegrationId,
  s: SettingsMap
): IntegrationConfig {
  const values: Record<string, string> = {}
  for (const f of INTEGRATIONS[id].fields) {
    const raw = s[f.key]
    if (raw) values[f.key] = f.secret ? openSecret(f.key, raw) : raw
    else if (f.defaultValue) values[f.key] = f.defaultValue
  }
  return {
    enabled: s[enabledKey(id)] === 'true',
    configured: isConfigured(id, s),
    values
  }
}

/** Decrypted config for one integration, from the hot settings snapshot. */
export async function getIntegrationConfig(
  id: IntegrationId
): Promise<IntegrationConfig> {
  const s = await getSettings(integrationSettingsKeys(id), { cache: 'hot' })
  return resolveIntegration(id, s)
}

export async function getAllIntegrationSettings(): Promise<SettingsMap> {
  return getSettings(ALL_KEYS)
}

/** `integration_<id>: 'true'` for each usable integration (public signal). */
export function publicIntegrationFlags(s: SettingsMap): Record<string, 'true'> {
  return Object.fromEntries(
    INTEGRATION_IDS.filter(id => isAvailable(id, s)).map(id => [
      availableFlag(id),
      'true' as const
    ])
  )
}
