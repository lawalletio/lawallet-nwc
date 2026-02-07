import type { AppConfig } from '@/lib/config'

// Wraps dynamic route params in Promise (Next.js App Router pattern)
export function createParamsPromise<T>(params: T): { params: Promise<T> } {
  return { params: Promise.resolve(params) }
}

// Returns a mock AppConfig with sane defaults for testing
export function createDefaultConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    env: 'test',
    isDevelopment: false,
    isTest: true,
    isProduction: false,
    logPretty: false,
    database: { url: 'postgresql://test' },
    jwt: { secret: 'test-jwt-secret', enabled: true },
    tally: { apiKey: 'test-tally-key', formId: 'test-form-id', enabled: true },
    alby: { apiUrl: undefined, bearerToken: undefined, autoGenerateSubAccounts: false, enabled: false },
    server: { port: 3000 },
    github: { token: undefined, projectNumber: undefined, enabled: false },
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576, maxFileSize: 10485760, maxFiles: 5 },
    rateLimit: {
      enabled: false,
      windowMs: 60000,
      maxRequests: 100,
      maxRequestsAuth: 20,
      upstash: { url: undefined, token: undefined, enabled: false },
    },
    ...overrides,
  } as AppConfig
}
