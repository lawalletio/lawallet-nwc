import { getEnv, type Env } from './env'

/**
 * Application configuration
 * Loads and validates environment variables, provides type-safe config access
 */
export interface AppConfig {
  env: Env['NODE_ENV']
  isDevelopment: boolean
  isTest: boolean
  isProduction: boolean
  logPretty: boolean

  // Database
  database: {
    url: string
  }

  // Authentication
  jwt: {
    secret: string | undefined
    enabled: boolean
  }

  // Nostr key vault — at-rest encryption of custodied keys (passkey accounts)
  keyVault: {
    secret: string | undefined
    enabled: boolean
  }

  nwcVault: {
    secret: string | undefined
    enabled: boolean
  }

  // NWC Listener service env values — raw inputs only. The EFFECTIVE config
  // (merged with the Settings DB, incl. the enable toggle) comes from
  // lib/listener-config.ts `getListenerConfig()`; consumers use that, not this.
  listener: {
    url: string | undefined
    /** Legacy/shared webhook secret. */
    secret: string | undefined
    /** Dedicated web-to-listener bearer secret when configured. */
    requestSecret: string | undefined
    requestTimeoutMs: number
  }

  // Server
  server: {
    port: number | undefined
  }

  // GitHub (for scripts)
  github: {
    token: string | undefined
    projectNumber: string | undefined
    enabled: boolean
  }

  // Maintenance
  maintenance: {
    enabled: boolean
  }

  // Request Size Limits
  requestLimits: {
    maxBodySize: number
    maxJsonSize: number
    maxFileSize: number
    maxFiles: number
  }

  nostrProfileCache: {
    dir: string | undefined
  }

  // Native Android wallet — feeds /.well-known/assetlinks.json and the
  // passkey `android:apk-key-hash:` origins.
  android: {
    packageName: string
    /** Valid fingerprints only, normalized to uppercase colon-hex. */
    certFingerprints: string[]
  }

  // Sentry error monitoring (server-side DSN)
  sentry: {
    dsn: string | undefined
    enabled: boolean
  }

  // Rate Limiting
  rateLimit: {
    enabled: boolean
    windowMs: number
    maxRequests: number
    maxRequestsAuth: number
    upstash: {
      url: string | undefined
      token: string | undefined
      enabled: boolean
    }
  }
}

let strictConfig: AppConfig | null = null
let relaxedConfig: AppConfig | null = null

/**
 * Get application configuration
 * Loads environment variables and returns a structured config object
 * Configuration is cached after first load
 * @param strict - If true, validates all required env vars. If false, uses defaults where possible.
 */
export function getConfig(strict: boolean = true): AppConfig {
  if (strict && strictConfig) {
    return strictConfig
  }

  if (!strict && relaxedConfig) {
    return relaxedConfig
  }

  const env = getEnv(strict)

  const config: AppConfig = {
    env: env.NODE_ENV,
    isDevelopment: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',
    isProduction: env.NODE_ENV === 'production',
    logPretty: env.LOG_PRETTY,

    database: {
      url: env.DATABASE_URL
    },

    jwt: {
      secret: env.JWT_SECRET,
      enabled: !!env.JWT_SECRET
    },

    keyVault: {
      secret: env.KEY_VAULT_SECRET,
      enabled: !!env.KEY_VAULT_SECRET
    },

    nwcVault: {
      secret: env.NWC_VAULT_SECRET,
      enabled: !!env.NWC_VAULT_SECRET
    },

    listener: {
      url: env.LISTENER_URL,
      secret: env.LISTENER_AUTH_SECRET,
      requestSecret: env.LISTENER_REQUEST_AUTH_SECRET,
      requestTimeoutMs: env.LISTENER_REQUEST_TIMEOUT_MS
    },

    server: {
      port: env.PORT
    },

    github: {
      token: env.GITHUB_TOKEN,
      projectNumber: env.GITHUB_PROJECT_NUMBER,
      enabled: !!(env.GITHUB_TOKEN && env.GITHUB_PROJECT_NUMBER)
    },

    maintenance: {
      enabled: env.MAINTENANCE_MODE
    },

    requestLimits: {
      maxBodySize: env.REQUEST_MAX_BODY_SIZE,
      maxJsonSize: env.REQUEST_MAX_JSON_SIZE,
      maxFileSize: env.REQUEST_MAX_FILE_SIZE,
      maxFiles: env.REQUEST_MAX_FILES
    },

    nostrProfileCache: {
      dir: env.NOSTR_PROFILE_CACHE_DIR
    },

    android: {
      packageName: env.ANDROID_APP_PACKAGE,
      certFingerprints: parseCertFingerprints(env.ANDROID_APP_CERT_SHA256)
    },

    sentry: {
      dsn: env.SENTRY_DSN,
      enabled: !!env.SENTRY_DSN
    },

    rateLimit: {
      enabled: env.RATE_LIMIT_ENABLED,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      maxRequests: env.RATE_LIMIT_MAX_REQUESTS,
      maxRequestsAuth: env.RATE_LIMIT_MAX_REQUESTS_AUTH,
      upstash: {
        url: env.UPSTASH_REDIS_URL,
        token: env.UPSTASH_REDIS_TOKEN,
        enabled: !!(env.UPSTASH_REDIS_URL && env.UPSTASH_REDIS_TOKEN)
      }
    }
  }

  if (strict) {
    strictConfig = config
    relaxedConfig = config
  } else {
    relaxedConfig = config
  }

  return config
}

const CERT_SHA256_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/

/** Splits `ANDROID_APP_CERT_SHA256`, dropping anything that is not a SHA-256 colon-hex fingerprint. */
function parseCertFingerprints(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(fp => fp.trim().toUpperCase())
    .filter(fp => CERT_SHA256_RE.test(fp))
}

/**
 * Reset cached configuration
 * Useful for testing or when environment variables change
 */
export function resetConfig(): void {
  strictConfig = null
  relaxedConfig = null
}

// Configuration is validated lazily when getConfig() is called
// This allows the module to be imported without requiring all env vars to be set
// Validation will happen when the config is actually accessed
