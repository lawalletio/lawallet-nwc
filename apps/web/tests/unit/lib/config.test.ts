import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// We need to test config/env with controlled environment variables.
// We cannot use vi.mock for env because getEnv reads process.env directly.

// Helper to set NODE_ENV without TS readonly error
function setNodeEnv(value: string) {
  ;(process.env as any).NODE_ENV = value
}

describe('getEnv', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    // Reset the cached env by re-importing
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns validated env with required DATABASE_URL', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    const { getEnv } = await import('@/lib/config/env')
    const env = getEnv()
    expect(env.DATABASE_URL).toBe('postgresql://localhost/test')
    expect(env.NODE_ENV).toBe('test')
  })

  it('throws in strict mode when DATABASE_URL is missing', async () => {
    delete process.env.DATABASE_URL
    const { getEnv } = await import('@/lib/config/env')
    expect(() => getEnv(true)).toThrow('Environment variable validation failed')
  })

  it('uses defaults for optional fields in non-strict mode', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    const { getEnv } = await import('@/lib/config/env')
    const env = getEnv(false)
    expect(env.MAINTENANCE_MODE).toBe(false)
    expect(env.RATE_LIMIT_ENABLED).toBe(true)
    expect(env.RATE_LIMIT_WINDOW_MS).toBe(60000)
    expect(env.RATE_LIMIT_MAX_REQUESTS).toBe(60)
    expect(env.RATE_LIMIT_MAX_REQUESTS_AUTH).toBe(300)
  })

  it('treats blank optional listener variables as unconfigured', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    process.env.LISTENER_URL = ''
    process.env.LISTENER_AUTH_SECRET = ''
    process.env.LISTENER_REQUEST_AUTH_SECRET = ''
    setNodeEnv('test')
    const { getEnv } = await import('@/lib/config/env')

    const env = getEnv(true)
    expect(env.LISTENER_URL).toBeUndefined()
    expect(env.LISTENER_AUTH_SECRET).toBeUndefined()
    expect(env.LISTENER_REQUEST_AUTH_SECRET).toBeUndefined()
  })

  it('treats blank Upstash variables as unconfigured', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    process.env.UPSTASH_REDIS_URL = ''
    process.env.UPSTASH_REDIS_TOKEN = ''
    setNodeEnv('test')
    const { getEnv } = await import('@/lib/config/env')

    const env = getEnv(true)
    expect(env.UPSTASH_REDIS_URL).toBeUndefined()
    expect(env.UPSTASH_REDIS_TOKEN).toBeUndefined()
  })

  it.each([
    ['a Redis connection string', 'rediss://default:pw@x.upstash.io:6379'],
    ['plain http', 'http://x.upstash.io'],
    ['embedded credentials', 'https://user:pw@x.upstash.io'],
    ['an embedded password', 'https://:pw@x.upstash.io']
  ])('rejects %s as UPSTASH_REDIS_URL', async (_label, url) => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    process.env.UPSTASH_REDIS_URL = url
    setNodeEnv('test')
    const { getEnv } = await import('@/lib/config/env')
    expect(() => getEnv(true)).toThrow('Environment variable validation failed')
  })

  it('validates JWT_SECRET min length', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    process.env.JWT_SECRET = 'short'
    setNodeEnv('test')
    const { getEnv } = await import('@/lib/config/env')
    expect(() => getEnv(true)).toThrow('Environment variable validation failed')
  })

  it('accepts valid JWT_SECRET', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    process.env.JWT_SECRET = 'a'.repeat(32)
    setNodeEnv('test')
    const { getEnv } = await import('@/lib/config/env')
    const env = getEnv()
    expect(env.JWT_SECRET).toBe('a'.repeat(32))
  })

  it('caches result after first call', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    const { getEnv } = await import('@/lib/config/env')
    const env1 = getEnv()
    const env2 = getEnv()
    expect(env1).toBe(env2) // Same reference
  })

  it('parses boolean env vars correctly', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    process.env.MAINTENANCE_MODE = 'true'
    process.env.LOG_PRETTY = 'true'
    const { getEnv } = await import('@/lib/config/env')
    const env = getEnv()
    expect(env.MAINTENANCE_MODE).toBe(true)
    expect(env.LOG_PRETTY).toBe(true)
  })

  it('defaults to non-strict with fallback DATABASE_URL', async () => {
    delete process.env.DATABASE_URL
    setNodeEnv('development')
    const { getEnv } = await import('@/lib/config/env')
    const env = getEnv(false)
    expect(env.DATABASE_URL).toBe('file:./dev.db')
  })

  it('does not reuse non-strict fallback for later strict validation', async () => {
    delete process.env.DATABASE_URL
    setNodeEnv('development')
    const { getEnv } = await import('@/lib/config/env')
    expect(getEnv(false).DATABASE_URL).toBe('file:./dev.db')
    expect(() => getEnv(true)).toThrow('Environment variable validation failed')
  })
})

describe('getEnvVar', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns a specific env var', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    const { getEnvVar } = await import('@/lib/config/env')
    expect(getEnvVar('NODE_ENV')).toBe('test')
  })
})

describe('getConfig', () => {
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    originalEnv = { ...process.env }
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('returns structured config', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    process.env.JWT_SECRET = 'a'.repeat(32)
    const { getConfig } = await import('@/lib/config')
    const config = getConfig()
    expect(config.env).toBe('test')
    expect(config.isTest).toBe(true)
    expect(config.isDevelopment).toBe(false)
    expect(config.isProduction).toBe(false)
    expect(config.database.url).toBe('postgresql://localhost/test')
    expect(config.jwt.secret).toBe('a'.repeat(32))
    expect(config.jwt.enabled).toBe(true)
  })

  it('reads the Vercel Marketplace KV_REST_API_* names as Upstash fallbacks', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    delete process.env.UPSTASH_REDIS_URL
    delete process.env.UPSTASH_REDIS_TOKEN
    process.env.KV_REST_API_URL = 'https://kv.upstash.io'
    process.env.KV_REST_API_TOKEN = 'kv-token'
    setNodeEnv('test')
    const { getConfig } = await import('@/lib/config')
    expect(getConfig().rateLimit.upstash).toEqual({
      url: 'https://kv.upstash.io',
      token: 'kv-token',
      enabled: true
    })
  })

  it('never pairs a URL from one variable set with a token from the other', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    process.env.UPSTASH_REDIS_URL = 'https://own.upstash.io'
    delete process.env.UPSTASH_REDIS_TOKEN
    process.env.KV_REST_API_URL = 'https://kv.upstash.io'
    process.env.KV_REST_API_TOKEN = 'kv-token'
    setNodeEnv('test')
    const { getConfig } = await import('@/lib/config')
    expect(getConfig().rateLimit.upstash).toEqual({
      url: 'https://kv.upstash.io',
      token: 'kv-token',
      enabled: true
    })
  })

  it('prefers UPSTASH_REDIS_* over the KV_REST_API_* fallbacks', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    process.env.UPSTASH_REDIS_URL = 'https://own.upstash.io'
    process.env.UPSTASH_REDIS_TOKEN = 'own-token'
    process.env.KV_REST_API_URL = 'https://kv.upstash.io'
    process.env.KV_REST_API_TOKEN = 'kv-token'
    setNodeEnv('test')
    const { getConfig } = await import('@/lib/config')
    expect(getConfig().rateLimit.upstash.url).toBe('https://own.upstash.io')
    expect(getConfig().rateLimit.upstash.token).toBe('own-token')
  })

  it('caches config and returns same reference', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    const { getConfig } = await import('@/lib/config')
    const c1 = getConfig()
    const c2 = getConfig()
    expect(c1).toBe(c2)
  })

  it('resetConfig clears cache', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    const { getConfig, resetConfig } = await import('@/lib/config')
    const c1 = getConfig()
    resetConfig()
    // After reset, getConfig will re-read env, returning a new object
    const c2 = getConfig()
    expect(c1).not.toBe(c2)
    expect(c1).toEqual(c2)
  })

  it('jwt.enabled is false when JWT_SECRET is not set', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    delete process.env.JWT_SECRET
    const { getConfig } = await import('@/lib/config')
    const config = getConfig()
    expect(config.jwt.enabled).toBe(false)
    expect(config.jwt.secret).toBeUndefined()
  })

  it('sets maintenance.enabled from MAINTENANCE_MODE', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    process.env.MAINTENANCE_MODE = 'true'
    const { getConfig } = await import('@/lib/config')
    const config = getConfig()
    expect(config.maintenance.enabled).toBe(true)
  })

  it('sets requestLimits from env defaults', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    const { getConfig } = await import('@/lib/config')
    const config = getConfig()
    expect(config.requestLimits.maxBodySize).toBe(1048576)
    expect(config.requestLimits.maxJsonSize).toBe(102400)
    expect(config.requestLimits.maxFileSize).toBe(5242880)
    expect(config.requestLimits.maxFiles).toBe(10)
  })

  it('normalizes LNCURL_API_KEY_ORIGIN to a bare origin, unset by default', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    delete process.env.LNCURL_API_KEY
    delete process.env.LNCURL_API_KEY_ORIGIN
    const { getConfig, resetConfig } = await import('@/lib/config')
    expect(getConfig().lncurl).toEqual({
      apiKey: undefined,
      apiKeyOrigin: undefined
    })

    process.env.LNCURL_API_KEY = 'k'.repeat(32)
    process.env.LNCURL_API_KEY_ORIGIN = 'https://LNCurl.example.com/some/path'
    resetConfig()
    vi.resetModules()
    const fresh = await import('@/lib/config')
    expect(fresh.getConfig().lncurl).toEqual({
      apiKey: 'k'.repeat(32),
      apiKeyOrigin: 'https://lncurl.example.com'
    })
  })

  it('sets rateLimit from env defaults', async () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test'
    setNodeEnv('test')
    const { getConfig } = await import('@/lib/config')
    const config = getConfig()
    expect(config.rateLimit.enabled).toBe(true)
    expect(config.rateLimit.windowMs).toBe(60000)
    expect(config.rateLimit.maxRequests).toBe(60)
    expect(config.rateLimit.maxRequestsAuth).toBe(300)
  })

  it('does not reuse non-strict fallback for later strict config validation', async () => {
    delete process.env.DATABASE_URL
    setNodeEnv('development')
    const { getConfig } = await import('@/lib/config')
    expect(getConfig(false).database.url).toBe('file:./dev.db')
    expect(() => getConfig(true)).toThrow(
      'Environment variable validation failed'
    )
  })
})
