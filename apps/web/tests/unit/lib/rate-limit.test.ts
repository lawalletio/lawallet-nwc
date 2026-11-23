import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkRateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { logger } from '@/lib/logger'

const NO_UPSTASH = { url: undefined, token: undefined, enabled: false }
let upstash: { url?: string; token?: string; enabled: boolean } = NO_UPSTASH

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    rateLimit: {
      enabled: true,
      windowMs: 60_000,
      maxRequests: 60,
      maxRequestsAuth: 300,
      upstash
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

describe('checkRateLimit with Upstash', () => {
  const UPSTASH_URL = 'https://redis.example.test/'
  let fetchMock: ReturnType<typeof vi.fn>
  let n = 0
  const ip = () => `198.51.100.${++n}`

  /** Stubs one `/pipeline` reply: INCR → count, PEXPIREAT → 1. */
  const pipelineReply = (count: number) =>
    new Response(JSON.stringify([{ result: count }, { result: 1 }]), {
      status: 200
    })

  beforeEach(() => {
    upstash = { url: UPSTASH_URL, token: 'tok', enabled: true }
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    upstash = NO_UPSTASH
    vi.unstubAllGlobals()
  })

  it('counts in a window-indexed key with INCR + PEXPIREAT', async () => {
    fetchMock.mockResolvedValueOnce(pipelineReply(1))
    const from = ip()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, 30))) // mid-window
    try {
      const result = await checkRateLimit(
        requestFrom(from),
        RateLimitPresets.sensitive
      )

      const window = Math.floor(Date.now() / 60_000)
      const resetMs = (window + 1) * 60_000
      expect(result).toEqual({
        success: true,
        limit: 5,
        remaining: 4,
        reset: resetMs / 1000
      })
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://redis.example.test/pipeline')
      // The 300ms budget is enforced by an abort signal on the request.
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.headers.Authorization).toBe('Bearer tok')
      const key = `ratelimit:anon:sensitive:${from}:${window}`
      // Two commands per check: the billed cost on Upstash pay-as-you-go.
      expect(JSON.parse(init.body)).toEqual([
        ['INCR', key],
        ['PEXPIREAT', key, String(resetMs + 1000)]
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('never logs a fetch error message, which can quote the URL', async () => {
    vi.mocked(logger.warn).mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 240_000) // past any earlier warning
    try {
      fetchMock.mockRejectedValue(
        new TypeError('cannot fetch rediss://default:SECRET@x/pipeline')
      )
      await checkRateLimit(requestFrom(ip()), RateLimitPresets.public)
      expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
        'SECRET'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects once the shared counter passes the limit', async () => {
    fetchMock.mockResolvedValueOnce(pipelineReply(6))

    const result = await checkRateLimit(
      requestFrom(ip()),
      RateLimitPresets.sensitive
    )

    expect(result).toMatchObject({ success: false, remaining: 0 })
  })

  it.each([
    ['network error', () => Promise.reject(new TypeError('fetch failed'))],
    [
      'timeout',
      () => Promise.reject(new DOMException('timed out', 'TimeoutError'))
    ],
    ['HTTP 500', () => Promise.resolve(new Response('', { status: 500 }))],
    [
      'non-numeric INCR reply',
      () =>
        Promise.resolve(
          new Response(JSON.stringify([{ result: 'x' }, {}, {}]), {
            status: 200
          })
        )
    ],
    [
      'non-array reply',
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'nope' }), { status: 200 })
        )
    ],
    [
      'command error',
      () =>
        Promise.resolve(
          new Response(JSON.stringify([{ error: 'WRONGPASS' }]), {
            status: 200
          })
        )
    ]
  ])('falls back to in-memory on %s', async (_label, reply) => {
    fetchMock.mockImplementation(reply)
    const from = ip()

    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit(
        requestFrom(from),
        RateLimitPresets.sensitive
      )
      expect(r.success).toBe(true)
    }
    // Fallback still enforces the limit rather than failing open forever.
    const sixth = await checkRateLimit(
      requestFrom(from),
      RateLimitPresets.sensitive
    )
    expect(sixth.success).toBe(false)
  })

  it('throttles the fallback warning', async () => {
    vi.mocked(logger.warn).mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 600_000) // past any earlier test's warning
    try {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'))
      for (let i = 0; i < 3; i++) {
        await checkRateLimit(requestFrom(ip()), RateLimitPresets.public)
      }
      expect(logger.warn).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('warns once and stays in-memory when only one variable is set', async () => {
    vi.mocked(logger.warn).mockClear()
    upstash = { url: UPSTASH_URL, token: undefined, enabled: false }

    await checkRateLimit(requestFrom(ip()), RateLimitPresets.public)
    await checkRateLimit(requestFrom(ip()), RateLimitPresets.public)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })

  it('logs its own error messages, e.g. an HTTP failure', async () => {
    vi.mocked(logger.warn).mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 1_800_000) // past any earlier warning
    try {
      fetchMock.mockResolvedValue(new Response('', { status: 503 }))
      await checkRateLimit(requestFrom(ip()), RateLimitPresets.public)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          errName: 'UpstashError',
          err: 'Upstash HTTP 503'
        })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs only the type of a non-Error rejection', async () => {
    vi.mocked(logger.warn).mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 2_400_000) // past any earlier warning
    try {
      fetchMock.mockRejectedValue('boom')
      await checkRateLimit(requestFrom(ip()), RateLimitPresets.public)
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ errName: 'string' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays in-memory and never calls fetch when env is unset', async () => {
    upstash = NO_UPSTASH

    const result = await checkRateLimit(
      requestFrom(ip()),
      RateLimitPresets.sensitive
    )

    expect(result).toMatchObject({ success: true, remaining: 4 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
