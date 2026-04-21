import { z } from 'zod'

const csv = (value: string): string[] =>
  value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),

  NT_PORT: z
    .string()
    .default('3010')
    .transform(v => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  NT_LOG_LEVEL: z
    .string()
    .default('info')
    .transform(v => v.toLowerCase())
    .pipe(
      z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    ),

  NT_LOG_PRETTY: z
    .string()
    .default('false')
    .transform(v => v === 'true')
    .pipe(z.boolean()),

  NT_MASTER_KEY: z
    .string()
    .min(1, 'NT_MASTER_KEY is required (base64-encoded 32 bytes)'),

  NT_ADMIN_SECRET: z
    .string()
    .min(16, 'NT_ADMIN_SECRET must be at least 16 characters')
    .optional(),

  DANGEROUSLY_FREE: z
    .string()
    .default('false')
    .transform(v => v === 'true')
    .pipe(z.boolean()),

  NT_SERVICE_NSEC: z
    .string()
    .min(1, 'NT_SERVICE_NSEC is required'),

  NT_CONTROL_RELAYS: z
    .string()
    .default('')
    .transform(csv),

  NT_LNURL_NSEC: z.string().optional(),

  NT_ZAP_DEFAULT_RELAYS: z
    .string()
    .default('')
    .transform(csv),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  REDIS_URL: z.string().default('redis://localhost:6379/0'),

  NT_WEBHOOK_MAX_ATTEMPTS: z
    .string()
    .default('12')
    .transform(v => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  NT_WEBHOOK_INITIAL_DELAY_MS: z
    .string()
    .default('10000')
    .transform(v => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  NT_WEBHOOK_MAX_DELAY_MS: z
    .string()
    .default('3600000')
    .transform(v => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  NT_WEBHOOK_TIMEOUT_MS: z
    .string()
    .default('10000')
    .transform(v => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  NT_DEDUP_TTL_SECONDS: z
    .string()
    .default('259200')
    .transform(v => parseInt(v, 10))
    .pipe(z.number().int().positive()),

  NT_CURSOR_OVERLAP_SECONDS: z
    .string()
    .default('60')
    .transform(v => parseInt(v, 10))
    .pipe(z.number().int().nonnegative())
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

export function getEnv(): Env {
  if (cached) return cached
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    const errors = result.error.errors
      .map(e => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n')
    throw new Error(
      `nostr-trigger environment validation failed:\n${errors}\n\n` +
        'Check your .env against apps/nostr-trigger/.env.example.'
    )
  }
  cached = result.data
  return cached
}

export function resetEnv(): void {
  cached = null
}
