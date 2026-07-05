import { z } from 'zod'

/**
 * Environment schema for the listener service. Mirrors the validation style
 * of apps/web/lib/config/env.ts — string inputs transformed to typed values,
 * readable errors at startup.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .describe('Postgres connection URL — same database as apps/web'),

  LISTENER_PORT: z
    .string()
    .default('4100')
    .transform(val => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .describe('HTTP port for /health, /status and /nwc/request'),

  LISTENER_AUTH_SECRET: z
    .string()
    .min(32, 'LISTENER_AUTH_SECRET must be at least 32 characters long')
    .describe(
      'Shared secret: signs webhooks to apps/web, guards the HTTP API as a bearer token'
    ),

  WEB_ORIGIN: z
    .string()
    .url('WEB_ORIGIN must be a valid URL')
    .describe('Base URL of apps/web — webhook target'),

  LOG_LEVEL: z
    .string()
    .default('info')
    .transform(val => val.toLowerCase())
    .pipe(
      z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    ),

  LOG_PRETTY: z
    .string()
    .default('false')
    .transform(val => val === 'true')
    .pipe(z.boolean()),

  RECONCILE_INTERVAL_MS: z
    .string()
    .default('300000')
    .transform(val => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .describe('Full pool reconcile interval — safety net for missed NOTIFYs'),

  NWC_REQUEST_TIMEOUT_MS: z
    .string()
    .default('30000')
    .transform(val => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .describe('Default timeout for proxied /nwc/request calls'),

  WEBHOOK_MAX_ATTEMPTS: z
    .string()
    .default('5')
    .transform(val => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .describe('Inline webhook delivery attempts before deferring to the sweep'),

  EVENT_RETENTION_DAYS: z
    .string()
    .default('30')
    .transform(val => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .describe('Days of processed events kept for dedup + the dashboard feed'),

  CATCHUP_ENABLED: z
    .string()
    .default('true')
    .transform(val => val === 'true')
    .pipe(z.boolean())
    .describe(
      'Recover events missed while offline (list_transactions + relay replay)'
    ),

  CATCHUP_MAX_WINDOW_HOURS: z
    .string()
    .default('24')
    .transform(val => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .describe(
      'Furthest back a catch-up will ever look, regardless of cursor age'
    ),

  CATCHUP_OVERLAP_SECONDS: z
    .string()
    .default('300')
    .transform(val => parseInt(val, 10))
    .pipe(z.number().int().nonnegative())
    .describe(
      'Safety overlap subtracted from the cursor (dedup absorbs the repeats)'
    ),

  CATCHUP_INTERVAL_MS: z
    .string()
    .default('900000')
    .transform(val => parseInt(val, 10))
    .pipe(z.number().int().nonnegative())
    .describe(
      'Periodic safety catch-up for all subscribed wallets (0 disables)'
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
    const errors = result.error.errors.map(
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
