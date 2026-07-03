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

  // NWC Listener service (optional relay bridge)
  listener: {
    url: string | undefined
    secret: string | undefined
    requestTimeoutMs: number
    /** Outbound bridge (status proxy + /nwc/request) — needs url AND secret. */
    enabled: boolean
    /** Inbound webhook acceptance — needs only the secret. */
    webhookEnabled: boolean
  }

  // Alby Integration
  alby: {
    apiUrl: string | undefined
    bearerToken: string | undefined
    autoGenerateSubAccounts: boolean
    enabled: boolean
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

    listener: {
      url: env.LISTENER_URL,
      secret: env.LISTENER_AUTH_SECRET,
      requestTimeoutMs: env.LISTENER_REQUEST_TIMEOUT_MS,
      enabled: !!(env.LISTENER_URL && env.LISTENER_AUTH_SECRET),
      webhookEnabled: !!env.LISTENER_AUTH_SECRET
    },

    alby: {
      apiUrl: env.ALBY_API_URL,
      bearerToken: env.ALBY_BEARER_TOKEN,
      autoGenerateSubAccounts: env.AUTO_GENERATE_ALBY_SUBACCOUNTS,
      enabled: !!(
        env.ALBY_API_URL &&
        env.ALBY_BEARER_TOKEN &&
        env.AUTO_GENERATE_ALBY_SUBACCOUNTS
      )
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
