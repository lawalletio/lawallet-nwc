import { getConfig } from '@/lib/config'
import { TooManyRequestsError } from '@/types/server/errors'
import { logger } from '@/lib/logger'

/**
 * Rate limit result with metadata for headers
 */
export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number // Unix timestamp (seconds)
}

/**
 * Rate limit options per endpoint type
 */
export interface RateLimitOptions {
  /** Custom window in milliseconds (overrides config) */
  windowMs?: number
  /** Custom max requests (overrides config) */
  maxRequests?: number
  /** Custom max requests for authenticated users (overrides config) */
  maxRequestsAuth?: number
  /** Custom identifier (defaults to IP) */
  identifier?: string
  /** Whether the request is authenticated */
  isAuthenticated?: boolean
}

/**
 * In-memory store for rate limiting
 * Maps identifier -> { count, resetTime }
 */
interface RateLimitEntry {
  count: number
  resetTime: number
}

const inMemoryStore = new Map<string, RateLimitEntry>()

/**
 * Clean up expired entries periodically
 */
function cleanupExpiredEntries(): void {
  const now = Date.now()
  for (const [key, entry] of inMemoryStore.entries()) {
    if (entry.resetTime <= now) {
      inMemoryStore.delete(key)
    }
  }
}

// Run cleanup every minute
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupExpiredEntries, 60_000)
}

/**
 * Extract client IP from request
 * Handles common proxy headers
 */
export function getClientIp(request: Request): string {
  // Check common proxy headers
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    // Take the first IP (original client)
    const firstIp = forwardedFor.split(',')[0]?.trim()
    if (firstIp) return firstIp
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp

  const cfConnectingIp = request.headers.get('cf-connecting-ip')
  if (cfConnectingIp) return cfConnectingIp

  // Fallback to a default identifier
  return 'unknown'
}

/**
 * In-memory rate limiter implementation
 * Suitable for single-instance deployments or development
 */
function checkRateLimitInMemory(
  identifier: string,
  windowMs: number,
  maxRequests: number
): RateLimitResult {
  const now = Date.now()
  const key = identifier
  const entry = inMemoryStore.get(key)

  // If no entry or expired, create new window
  if (!entry || entry.resetTime <= now) {
    const resetTime = now + windowMs
    inMemoryStore.set(key, { count: 1, resetTime })
    return {
      success: true,
      limit: maxRequests,
      remaining: maxRequests - 1,
      reset: Math.ceil(resetTime / 1000)
    }
  }

  // Increment counter
  entry.count++
  inMemoryStore.set(key, entry)

  const remaining = Math.max(0, maxRequests - entry.count)
  const success = entry.count <= maxRequests

  return {
    success,
    limit: maxRequests,
    remaining,
    reset: Math.ceil(entry.resetTime / 1000)
  }
}

/**
 * Check rate limit for a request
 * Uses in-memory store (Upstash support can be added later)
 */
export async function checkRateLimit(
  request: Request,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const config = getConfig(false)

  // If rate limiting is disabled, always allow
  if (!config.rateLimit.enabled) {
    return {
      success: true,
      limit: Infinity,
      remaining: Infinity,
      reset: 0
    }
  }

  const windowMs = options.windowMs ?? config.rateLimit.windowMs
  const maxRequests = options.isAuthenticated
    ? (options.maxRequestsAuth ?? config.rateLimit.maxRequestsAuth)
    : (options.maxRequests ?? config.rateLimit.maxRequests)

  const identifier = options.identifier ?? getClientIp(request)
  const prefix = options.isAuthenticated ? 'auth' : 'anon'
  const key = `ratelimit:${prefix}:${identifier}`

  return checkRateLimitInMemory(key, windowMs, maxRequests)
}

/**
 * Apply rate limit headers to a Response
 */
export function applyRateLimitHeaders(
  response: Response,
  result: RateLimitResult
): Response {
  const headers = new Headers(response.headers)

  headers.set('X-RateLimit-Limit', result.limit.toString())
  headers.set('X-RateLimit-Remaining', result.remaining.toString())
  headers.set('X-RateLimit-Reset', result.reset.toString())

  if (!result.success) {
    headers.set('Retry-After', Math.max(1, result.reset - Math.floor(Date.now() / 1000)).toString())
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

/**
 * Rate limiting middleware for API routes
 * Throws TooManyRequestsError if limit exceeded
 *
 * @example
 * ```ts
 * export async function GET(request: Request) {
 *   await rateLimit(request)
 *   // ... handle request
 * }
 * ```
 *
 * @example With custom options
 * ```ts
 * export async function POST(request: Request) {
 *   await rateLimit(request, {
 *     maxRequests: 10,
 *     windowMs: 60000,
 *     isAuthenticated: !!user
 *   })
 *   // ... handle request
 * }
 * ```
 */
export async function rateLimit(
  request: Request,
  options: RateLimitOptions = {}
): Promise<RateLimitResult> {
  const result = await checkRateLimit(request, options)

  if (!result.success) {
    const retryAfter = Math.max(1, result.reset - Math.floor(Date.now() / 1000))

    logger.warn({
      msg: 'Rate limit exceeded',
      ip: getClientIp(request),
      path: new URL(request.url).pathname,
      limit: result.limit,
      retryAfter
    })

    throw new TooManyRequestsError('Rate limit exceeded. Please try again later.', {
      retryAfter,
      details: {
        limit: result.limit,
        reset: result.reset
      }
    })
  }

  return result
}

/**
 * Preset rate limit configurations for different endpoint types
 */
export const RateLimitPresets = {
  /** Standard public endpoints (60 req/min) */
  public: {} as RateLimitOptions,

  /** Authentication endpoints (10 req/min) */
  auth: {
    maxRequests: 10,
    maxRequestsAuth: 30
  } as RateLimitOptions,

  /** Sensitive operations (5 req/min) */
  sensitive: {
    maxRequests: 5,
    maxRequestsAuth: 20
  } as RateLimitOptions,

  /** Card scan callbacks (high volume, 200 req/min) */
  cardScan: {
    maxRequests: 200,
    maxRequestsAuth: 500
  } as RateLimitOptions,

  /** LUD16 lookups (high volume, 120 req/min) */
  lud16: {
    maxRequests: 120,
    maxRequestsAuth: 300
  } as RateLimitOptions
} as const
