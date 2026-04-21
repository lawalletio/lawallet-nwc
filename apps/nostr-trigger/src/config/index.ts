import { getEnv, type Env } from './env.js'

export interface AppConfig {
  env: Env['NODE_ENV']
  isDevelopment: boolean
  isTest: boolean
  isProduction: boolean

  http: {
    port: number
    adminSecret: string
  }

  log: {
    level: Env['NT_LOG_LEVEL']
    pretty: boolean
  }

  security: {
    masterKeyBase64: string
  }

  nostr: {
    serviceNsec: string
    controlRelays: string[]
    lnurlNsec: string | undefined
    zapDefaultRelays: string[]
  }

  storage: {
    databaseUrl: string
    redisUrl: string
  }

  webhook: {
    maxAttempts: number
    initialDelayMs: number
    maxDelayMs: number
    timeoutMs: number
  }

  runtime: {
    dedupTtlSeconds: number
    cursorOverlapSeconds: number
  }
}

let cachedConfig: AppConfig | null = null

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig

  const env = getEnv()

  cachedConfig = {
    env: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',
    isProduction: env.NODE_ENV === 'production',

    http: {
      port: env.NT_PORT,
      adminSecret: env.NT_ADMIN_SECRET
    },

    log: {
      level: env.NT_LOG_LEVEL,
      pretty: env.NT_LOG_PRETTY
    },

    security: {
      masterKeyBase64: env.NT_MASTER_KEY
    },

    nostr: {
      serviceNsec: env.NT_SERVICE_NSEC,
      controlRelays: env.NT_CONTROL_RELAYS,
      lnurlNsec: env.NT_LNURL_NSEC,
      zapDefaultRelays: env.NT_ZAP_DEFAULT_RELAYS
    },

    storage: {
      databaseUrl: env.DATABASE_URL,
      redisUrl: env.REDIS_URL
    },

    webhook: {
      maxAttempts: env.NT_WEBHOOK_MAX_ATTEMPTS,
      initialDelayMs: env.NT_WEBHOOK_INITIAL_DELAY_MS,
      maxDelayMs: env.NT_WEBHOOK_MAX_DELAY_MS,
      timeoutMs: env.NT_WEBHOOK_TIMEOUT_MS
    },

    runtime: {
      dedupTtlSeconds: env.NT_DEDUP_TTL_SECONDS,
      cursorOverlapSeconds: env.NT_CURSOR_OVERLAP_SECONDS
    }
  }

  return cachedConfig
}

export function resetConfig(): void {
  cachedConfig = null
}
