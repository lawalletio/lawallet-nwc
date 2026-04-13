import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  checkRateLimit,
  rateLimit,
  getClientIp,
  applyRateLimitHeaders,
  RateLimitPresets
} from './rate-limit'
import { TooManyRequestsError } from '@/types/server/errors'

// Mock the config module
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    rateLimit: {
      enabled: true,
      windowMs: 60000,
      maxRequests: 10,
      maxRequestsAuth: 50,
      upstash: {
        url: undefined,
        token: undefined,
        enabled: false
      }
    }
  }))
}))

// Mock logger to avoid console output in tests
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn()
  }
}))

function createMockRequest(options: {
  ip?: string
  url?: string
  headers?: Record<string, string>
} = {}): Request {
  const headers = new Headers(options.headers || {})
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip)
  }
  return new Request(options.url || 'http://localhost/api/test', { headers })
}

describe('rate-limit', () => {
  beforeEach(() => {
    // Clear the in-memory store between tests by making many requests
    // This is a workaround since the store is private
    vi.clearAllMocks()
  })

  describe('getClientIp', () => {
    it('should extract IP from x-forwarded-for header', () => {
      const request = createMockRequest({
        headers: { 'x-forwarded-for': '192.168.1.1, 10.0.0.1' }
      })
      expect(getClientIp(request)).toBe('192.168.1.1')
    })

    it('should extract IP from x-real-ip header', () => {
      const request = createMockRequest({
        headers: { 'x-real-ip': '192.168.1.2' }
      })
      expect(getClientIp(request)).toBe('192.168.1.2')
    })

    it('should extract IP from cf-connecting-ip header', () => {
      const request = createMockRequest({
        headers: { 'cf-connecting-ip': '192.168.1.3' }
      })
      expect(getClientIp(request)).toBe('192.168.1.3')
    })

    it('should return "unknown" when no IP headers present', () => {
      const request = createMockRequest({})
      expect(getClientIp(request)).toBe('unknown')
    })

    it('should prioritize x-forwarded-for over other headers', () => {
      const request = createMockRequest({
        headers: {
          'x-forwarded-for': '192.168.1.1',
          'x-real-ip': '192.168.1.2',
          'cf-connecting-ip': '192.168.1.3'
        }
      })
      expect(getClientIp(request)).toBe('192.168.1.1')
    })
  })

  describe('checkRateLimit', () => {
    it('should allow requests under the limit', async () => {
      const request = createMockRequest({ ip: '10.0.0.1' })
      const result = await checkRateLimit(request)

      expect(result.success).toBe(true)
      expect(result.limit).toBe(10)
      expect(result.remaining).toBe(9)
      expect(result.reset).toBeGreaterThan(Date.now() / 1000)
    })

    it('should use higher limit for authenticated requests', async () => {
      const request = createMockRequest({ ip: '10.0.0.2' })
      const result = await checkRateLimit(request, { isAuthenticated: true })

      expect(result.success).toBe(true)
      expect(result.limit).toBe(50)
      expect(result.remaining).toBe(49)
    })

    it('should use custom limits when provided', async () => {
      const request = createMockRequest({ ip: '10.0.0.3' })
      const result = await checkRateLimit(request, { maxRequests: 5 })

      expect(result.success).toBe(true)
      expect(result.limit).toBe(5)
      expect(result.remaining).toBe(4)
    })

    it('should decrement remaining count on each request', async () => {
      const request = createMockRequest({ ip: '10.0.0.4' })

      const result1 = await checkRateLimit(request)
      expect(result1.remaining).toBe(9)

      const result2 = await checkRateLimit(request)
      expect(result2.remaining).toBe(8)

      const result3 = await checkRateLimit(request)
      expect(result3.remaining).toBe(7)
    })

    it('should reject requests over the limit', async () => {
      const request = createMockRequest({ ip: '10.0.0.5' })

      // Make requests up to the limit
      for (let i = 0; i < 10; i++) {
        await checkRateLimit(request)
      }

      // This should be rejected
      const result = await checkRateLimit(request)
      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    })
  })

  describe('rateLimit', () => {
    it('should return result for allowed requests', async () => {
      const request = createMockRequest({ ip: '10.0.1.1' })
      const result = await rateLimit(request)

      expect(result.success).toBe(true)
    })

    it('should throw TooManyRequestsError when limit exceeded', async () => {
      const request = createMockRequest({ ip: '10.0.1.2' })

      // Make requests up to the limit
      for (let i = 0; i < 10; i++) {
        await rateLimit(request)
      }

      // This should throw
      await expect(rateLimit(request)).rejects.toThrow(TooManyRequestsError)
    })

    it('should include retryAfter in error', async () => {
      const request = createMockRequest({ ip: '10.0.1.3' })

      // Exhaust the limit
      for (let i = 0; i < 10; i++) {
        await rateLimit(request)
      }

      try {
        await rateLimit(request)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TooManyRequestsError)
        expect((error as TooManyRequestsError).retryAfter).toBeGreaterThan(0)
      }
    })
  })

  describe('applyRateLimitHeaders', () => {
    it('should add rate limit headers to response', () => {
      const response = new Response('OK', { status: 200 })
      const result = {
        success: true,
        limit: 100,
        remaining: 95,
        reset: Math.floor(Date.now() / 1000) + 60
      }

      const newResponse = applyRateLimitHeaders(response, result)

      expect(newResponse.headers.get('X-RateLimit-Limit')).toBe('100')
      expect(newResponse.headers.get('X-RateLimit-Remaining')).toBe('95')
      expect(newResponse.headers.get('X-RateLimit-Reset')).toBe(result.reset.toString())
    })

    it('should add Retry-After header when rate limited', () => {
      const response = new Response('Too Many Requests', { status: 429 })
      const resetTime = Math.floor(Date.now() / 1000) + 30
      const result = {
        success: false,
        limit: 100,
        remaining: 0,
        reset: resetTime
      }

      const newResponse = applyRateLimitHeaders(response, result)

      expect(newResponse.headers.get('Retry-After')).toBeDefined()
      expect(parseInt(newResponse.headers.get('Retry-After')!)).toBeGreaterThan(0)
    })
  })

  describe('RateLimitPresets', () => {
    it('should have preset for public endpoints', () => {
      expect(RateLimitPresets.public).toBeDefined()
    })

    it('should have stricter preset for auth endpoints', () => {
      expect(RateLimitPresets.auth).toBeDefined()
      expect(RateLimitPresets.auth.maxRequests).toBe(10)
    })

    it('should have strictest preset for sensitive operations', () => {
      expect(RateLimitPresets.sensitive).toBeDefined()
      expect(RateLimitPresets.sensitive.maxRequests).toBe(5)
    })

    it('should have high-volume preset for card scans', () => {
      expect(RateLimitPresets.cardScan).toBeDefined()
      expect(RateLimitPresets.cardScan.maxRequests).toBe(200)
    })

    it('should have high-volume preset for LUD16', () => {
      expect(RateLimitPresets.lud16).toBeDefined()
      expect(RateLimitPresets.lud16.maxRequests).toBe(120)
    })
  })
})
