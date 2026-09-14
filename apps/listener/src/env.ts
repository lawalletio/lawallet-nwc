import { z } from 'zod'
import { WALLET_ARCHIVE_IDLE_HOURS } from '@lawallet-nwc/shared'

const emptyEnvToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value

/**
 * Wraps a schema so a blank value counts as unset. Rendered deployment
 * templates emit `VAR=` for every field the operator left empty — Compose's
 * `${VAR:-}`, the Umbrel and Start9 packages and Coolify's env editor all do
 * it. Zod only applies a `.default()` to `undefined`, so without this a blank
 * tunable is `parseInt('')` → NaN and the daemon refuses to boot over a value
 * nobody set, or — worse, for the booleans — reads as `false` and silently
 * disables the feature it gates.
 */
const blankIsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess(emptyEnvToUndefined, schema)

/**
 * Integer tunable with a default. `min` is 1 (the old `.positive()`) unless a
 * field uses 0 as its "disabled" value.
 */
const intEnv = (fallback: number, { min = 1 }: { min?: number } = {}) =>
  blankIsUnset(
    z
      .string()
      .default(String(fallback))
      .transform(val => parseInt(val, 10))
      .pipe(z.number().int().min(min))
  )

/**
 * Boolean tunable with a default. Parsing stays permissive — a typo must
 * never stop a running deployment from booting — but it is case- and
 * whitespace-insensitive, so `TRUE` means what the operator meant.
 */
const boolEnv = (fallback: boolean) =>
  blankIsUnset(
    z
      .string()
      .default(String(fallback))
      .transform(val => val.trim().toLowerCase() === 'true')
      .pipe(z.boolean())
  )

/** Product lock: a reported wallet is retried every 6h, not every 60s. */
const WALLET_ARCHIVE_RETRY_MS = 6 * 60 * 60 * 1000

/**
 * Environment schema for the listener service. Mirrors the validation style
 * of apps/web/lib/config/env.ts — string inputs transformed to typed values,
 * readable errors at startup.
 *
 * Only DATABASE_URL, LISTENER_AUTH_SECRET, WEB_ORIGIN and NWC_VAULT_SECRET
 * are an operator's responsibility. Every other variable has a default, so
 * upgrading into a release that adds a tunable never means editing a
 * deployment — keep it that way when adding one.
 */
const envSchema = z.object({
  NODE_ENV: blankIsUnset(
    z.enum(['development', 'test', 'production']).default('development')
  ),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .describe('Postgres connection URL — same database as apps/web'),

  LISTENER_PORT: intEnv(4100).describe(
    'HTTP port for health, status, legacy proxy and idempotent payment APIs'
  ),

  LISTENER_AUTH_SECRET: z
    .string()
    .min(32, 'LISTENER_AUTH_SECRET must be at least 32 characters long')
    .describe(
      'Webhook signing secret; also guards HTTP as a compatibility fallback'
    ),

  LISTENER_REQUEST_AUTH_SECRET: blankIsUnset(
    z
      .string()
      .min(
        32,
        'LISTENER_REQUEST_AUTH_SECRET must be at least 32 characters long'
      )
      .optional()
      .describe(
        'Optional dedicated web-to-listener bearer secret (falls back to LISTENER_AUTH_SECRET)'
      )
  ),

  WEB_ORIGIN: z
    .string()
    .url('WEB_ORIGIN must be a valid URL')
    .describe('Base URL of apps/web — webhook target'),

  NWC_VAULT_SECRET: blankIsUnset(
    z
      .string()
      .min(32, 'NWC_VAULT_SECRET must be at least 32 characters long')
      .describe(
        'Decrypts RemoteWallet NWC connection strings and the system proxy credentials stored by apps/web'
      )
  ),

  PROXY_RECONCILE_INTERVAL_MS: intEnv(600000).describe(
    'How often the deferred LUD-16 proxy pipeline is reconciled'
  ),

  ZAP_SETTLE_INTERVAL_MS: intEnv(20000, { min: 0 }).describe(
    'How often web polls pending zap invoices to settlement, covering wallets that emit no NIP-47 notifications (0 disables)'
  ),

  LOG_LEVEL: blankIsUnset(
    z
      .string()
      .default('info')
      .transform(val => val.trim().toLowerCase())
      .pipe(
        z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      )
  ),

  LOG_PRETTY: boolEnv(false),

  RECONCILE_INTERVAL_MS: intEnv(300000).describe(
    'Full pool reconcile interval — safety net for missed NOTIFYs'
  ),

  NWC_REQUEST_TIMEOUT_MS: intEnv(30000).describe(
    'Default timeout for proxied /nwc/request calls'
  ),

  WEBHOOK_MAX_ATTEMPTS: intEnv(5).describe(
    'Inline webhook delivery attempts before deferring to the sweep'
  ),

  EVENT_RETENTION_DAYS: intEnv(30).describe(
    'Days of processed events kept for dedup + the dashboard feed'
  ),

  CATCHUP_ENABLED: boolEnv(true).describe(
    'Recover events missed while offline (list_transactions + relay replay)'
  ),

  CATCHUP_MAX_WINDOW_HOURS: intEnv(24).describe(
    'Furthest back a catch-up will ever look, regardless of cursor age'
  ),

  CATCHUP_OVERLAP_SECONDS: intEnv(300, { min: 0 }).describe(
    'Safety overlap subtracted from the cursor (dedup absorbs the repeats)'
  ),

  CATCHUP_INTERVAL_MS: intEnv(900000, { min: 0 }).describe(
    'Periodic safety catch-up for all subscribed wallets (0 disables)'
  ),

  DEAD_WALLET_DETECTION_ENABLED: boolEnv(true).describe(
    'Archive a wallet as DEAD when it stops answering for DEAD_THRESHOLD_HOURS while its relays stay connected (LNCurl-provider wallets only, enforced web-side)'
  ),

  DEAD_THRESHOLD_HOURS: intEnv(4).describe(
    'Hours of no response (relays up) before a wallet is declared dead'
  ),

  DEAD_PROBE_INTERVAL_MS: intEnv(900000).describe(
    'How often the dead-wallet prober sweeps subscribed wallets'
  ),

  DEAD_PROBE_TIMEOUT_MS: intEnv(10000).describe(
    'Per-probe get_info timeout — a clean timeout (relays up) is the death signal'
  ),

  SENTRY_DSN: blankIsUnset(
    z
      .string()
      .url('SENTRY_DSN must be a valid URL')
      .optional()
      .describe('Optional Sentry DSN — error reporting is disabled when unset')
  ),

  SENTRY_ENVIRONMENT: blankIsUnset(
    z
      .string()
      .optional()
      .describe('Sentry environment tag (falls back to NODE_ENV)')
  ),

  SENTRY_RELEASE: blankIsUnset(
    z
      .string()
      .optional()
      .describe(
        'Release identifier (git SHA), baked into the image at build time — release health is only tracked when set'
      )
  ),

  DEAD_CONFIRMATION_PROBES: intEnv(3).describe(
    'Consecutive failing probes (relays up) required before declaring a wallet dead — guards against a single transient slow reply'
  ),

  WALLET_ARCHIVE_IDLE_HOURS: intEnv(WALLET_ARCHIVE_IDLE_HOURS).describe(
    'Hours without any proof of life before a wallet is reported for archival, probe or no probe — covers wallets that never completed warmup (product rule: 48h)'
  ),

  WALLET_ARCHIVE_RETRY_MS: intEnv(WALLET_ARCHIVE_RETRY_MS).describe(
    'How long a wallet stays parked after a wallet_dead report — its reconnect backoff and the next report attempt (default 6h)'
  )
})

export type ListenerEnv = z.infer<typeof envSchema>

let cached: ListenerEnv | null = null

/**
 * Validates and memoizes the environment. In dev the worktree bootstrap
 * writes apps/listener/.env.local — loaded best-effort here so `pnpm
 * dev:listener` works without exporting anything; a no-op in Docker where
 * the real environment is injected.
 */
export function getEnv(): ListenerEnv {
  if (cached) return cached

  try {
    process.loadEnvFile(new URL('../.env.local', import.meta.url).pathname)
  } catch {
    // no .env.local — rely on process env
  }

  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const errors = result.error.issues.map(
      err => `  - ${err.path.join('.')}: ${err.message}`
    )
    throw new Error(
      `Listener environment validation failed:\n${errors.join('\n')}\n\n` +
        'Run `pnpm dev:setup` at the repo root to provision apps/listener/.env.local, ' +
        'or set the variables in the container environment.'
    )
  }

  cached = result.data
  return cached
}

/** Test hook — clears the memoized env. */
export function resetEnv(): void {
  cached = null
}
