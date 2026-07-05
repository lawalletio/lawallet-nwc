import { getConfig } from '@/lib/config'
import { getSettings } from '@/lib/settings'
import { logger } from '@/lib/logger'

/**
 * Minimum shared-secret length — mirrors the LISTENER_AUTH_SECRET Zod floor
 * in lib/config/env.ts and the listener's own env validation. Shorter values
 * (from a hand-edited Settings row) are ignored rather than weakening the
 * HMAC.
 */
const MIN_SECRET_LENGTH = 32

export type ListenerValueSource = 'settings' | 'env' | 'none'

export interface ResolvedListenerConfig {
  enabled: boolean
  url: string | null
  secret: string | null
  /** Env-only tunable (LISTENER_REQUEST_TIMEOUT_MS) — not settings-driven. */
  requestTimeoutMs: number
  urlSource: ListenerValueSource
  secretSource: ListenerValueSource
  enabledSource: 'settings' | 'env-auto' | 'none'
}

export const LISTENER_SETTING_KEYS = [
  'listener_enabled',
  'listener_url',
  'listener_auth_secret',
] as const

/**
 * Effective NWC-listener pairing config: Settings DB merged over env vars.
 * The single source of truth for the merge — the webhook receiver, the
 * status proxy, the driver fast-path bridge and the settings UI all resolve
 * through here.
 *
 * Semantics:
 *  - `listener_url` / `listener_auth_secret`: DB value wins when set
 *    (empty string = unset), else the LISTENER_* env var.
 *  - `listener_enabled` row `'true'` → enabled iff an effective url + secret
 *    resolve; `'false'` → force-off (even over env); no row → env-auto:
 *    enabled iff BOTH env vars are present (docker-compose zero-config).
 *  - DB read failure → env-only fallback. A settings hiccup must never take
 *    payments down.
 */
export async function getListenerConfig(): Promise<ResolvedListenerConfig> {
  const envListener = getConfig(false).listener
  const envUrl = envListener?.url ?? undefined
  const envSecret = envListener?.secret ?? undefined
  const requestTimeoutMs = envListener?.requestTimeoutMs ?? 10000

  let db: Record<string, string> = {}
  try {
    db = (await getSettings([...LISTENER_SETTING_KEYS])) ?? {}
  } catch (err) {
    logger.warn({ err }, 'listener_config.settings_read_failed — using env only')
  }

  const dbUrl = db.listener_url?.trim() || undefined
  let dbSecret = db.listener_auth_secret || undefined
  if (dbSecret && dbSecret.length < MIN_SECRET_LENGTH) {
    logger.warn(
      'listener_config.stored_secret_too_short — ignoring (min 32 chars)'
    )
    dbSecret = undefined
  }

  const url = dbUrl ?? envUrl ?? null
  const secret = dbSecret ?? envSecret ?? null
  const urlSource: ListenerValueSource = dbUrl ? 'settings' : envUrl ? 'env' : 'none'
  const secretSource: ListenerValueSource = dbSecret
    ? 'settings'
    : envSecret
      ? 'env'
      : 'none'

  const enabledRow = db.listener_enabled
  let enabled: boolean
  let enabledSource: ResolvedListenerConfig['enabledSource']
  if (enabledRow === 'true' || enabledRow === 'false') {
    enabled = enabledRow === 'true' && !!url && !!secret
    enabledSource = 'settings'
  } else {
    // No explicit toggle — auto-enable only on a full env pair so
    // docker-compose / Umbrel / Start9 bundles work with zero configuration.
    enabled = !!(envUrl && envSecret)
    enabledSource = enabled ? 'env-auto' : 'none'
  }

  return { enabled, url, secret, requestTimeoutMs, urlSource, secretSource, enabledSource }
}
