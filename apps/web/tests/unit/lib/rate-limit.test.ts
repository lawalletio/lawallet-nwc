import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkRateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    rateLimit: {
      enabled: true,
      windowMs: 60_000,
      maxRequests: 60,
      maxRequestsAuth: 300
    }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

/** A request carrying a fixed client IP so every call keys to one identifier. */
function requestFrom(ip: string): Request {
  return new Request('https://example.test/api/whatever', {
    headers: { 'x-forwarded-for': ip }
  })
}

describe('checkRateLimit bucketing', () => {
  let ipCounter = 0

  beforeEach(() => {
    // The store is module-level and shared across tests; a fresh IP per test
    // is cheaper and less brittle than reaching in to clear it.
    ipCounter += 1
  })

  const ip = () => `203.0.113.${ipCounter}`

  it('does not let one preset spend another preset budget', async () => {
    const from = ip()

    // Burn well past the `sensitive` limit (5/min) on `public` (60/min).
    for (let i = 0; i < 10; i++) {
      const result = await checkRateLimit(
        requestFrom(from),
        RateLimitPresets.public
      )
      expect(result.success).toBe(true)
    }

    // A `sensitive` route from the same IP must still have its full budget.
    // Before bucketing, the shared counter was already at 10 and this 429'd —
    // one person typing a username could block card activation for everyone
    // behind the same proxy IP.
    const sensitive = await checkRateLimit(
      requestFrom(from),
      RateLimitPresets.sensitive
    )
    expect(sensitive.success).toBe(true)
    expect(sensitive.remaining).toBe(4)
  })

  it('still enforces the limit within a single bucket', async () => {
    const from = ip()

    for (let i = 0; i < 5; i++) {
      const result = await checkRateLimit(
        requestFrom(from),
        RateLimitPresets.sensitive
      )
      expect(result.success).toBe(true)
    }

    const sixth = await checkRateLimit(
      requestFrom(from),
      RateLimitPresets.sensitive
    )
    expect(sixth.success).toBe(false)
  })

  it('keeps separate identifiers in separate counters', async () => {
    const a = ip()
    ipCounter += 1
    const b = ip()

    for (let i = 0; i < 5; i++) {
      await checkRateLimit(requestFrom(a), RateLimitPresets.sensitive)
    }

    const other = await checkRateLimit(
      requestFrom(b),
      RateLimitPresets.sensitive
    )
    expect(other.success).toBe(true)
  })

  it('separates authenticated from anonymous traffic for the same identifier', async () => {
    const from = ip()

    for (let i = 0; i < 5; i++) {
      await checkRateLimit(requestFrom(from), RateLimitPresets.sensitive)
    }

    const authed = await checkRateLimit(requestFrom(from), {
      ...RateLimitPresets.sensitive,
      isAuthenticated: true
    })
    expect(authed.success).toBe(true)
  })
})
