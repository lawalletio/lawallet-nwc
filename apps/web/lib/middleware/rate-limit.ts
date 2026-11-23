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
  /**
   * Counter namespace. Callers sharing a bucket share one counter, so a
   * high-volume endpoint must never share with a low-limit one: a few
   * username-availability lookups would otherwise exhaust the 5/min
   * `sensitive` budget that card activation reads from. Presets set this;
   * callers passing raw options fall back to `'default'`.
   *
   * Deliberately NOT the request path — dynamic segments like
   * `/api/cards/<id>/scan` would let a caller mint a fresh counter per
   * attacker-chosen id and bypass the limit entirely.
   */
  bucket?: string
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
 * Extracts the client IP from common proxy headers.
 * Checks `x-forwarded-for` (first hop), then `x-real-ip`, then `cf-connecting-ip`.
 *
 * @returns The resolved IP, or `'unknown'` when no proxy header is present.
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

const UPSTASH_TIMEOUT_MS = 300
const UPSTASH_WARN_INTERVAL_MS = 60_000
let lastUpstashWarnAt = 0
let warnedHalfConfig = false

/** A failure this module raised itself: its message is safe to log. */
class UpstashError extends Error {
  override name = 'UpstashError'
}

/**
 * Shared fixed-window limiter over Upstash's REST `/multi-exec` endpoint, so
 * every serverless instance counts against one counter. `PEXPIRE … NX` only
 * arms the TTL on the request that opened the window; running the three
 * commands as one transaction keeps PTTL from seeing the key expire after
 * the INCR.
 *
 * @throws On HTTP failure, a per-command error, or the timeout — the caller
 * falls back to in-memory.
 */
async function checkRateLimitUpstash(
  key: string,
  windowMs: number,
  maxRequests: number,
  upstash: { url: string; token: string }
): Promise<RateLimitResult> {
  const res = await fetch(`${upstash.url.replace(/\/+$/, '')}/multi-exec`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${upstash.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([
      ['INCR', key],
      ['PEXPIRE', key, String(windowMs), 'NX'],
      ['PTTL', key]
    ]),
    signal: AbortSignal.timeout(UPSTASH_TIMEOUT_MS),
    cache: 'no-store'
  })
  if (!res.ok) throw new UpstashError(`Upstash HTTP ${res.status}`)

  const replies = (await res.json()) as unknown
  if (!Array.isArray(replies)) throw new UpstashError('Upstash: bad reply')
  const failed = (replies as { error?: string }[]).find(r => r?.error)
  if (failed) throw new UpstashError(`Upstash: ${failed.error}`)

  const count = Number(replies[0]?.result)
  if (!Number.isFinite(count)) throw new UpstashError('Upstash: bad INCR reply')
  const pttl = Number(replies[2]?.result)
  // -1/-2 (no TTL / key gone) should not happen after PEXPIRE; assume a fresh window.
  const resetMs = Date.now() + (pttl > 0 ? pttl : windowMs)

  return {
    success: count <= maxRequests,
    limit: maxRequests,
    remaining: Math.max(0, maxRequests - count),
    reset: Math.ceil(resetMs / 1000)
  }
}

/**
 * Check rate limit for a request. Uses Upstash Redis when
 * `UPSTASH_REDIS_URL` + `UPSTASH_REDIS_TOKEN` are set; otherwise, or whenever
 * Redis errors or times out, the per-instance in-memory store. Never fails
 * closed on a Redis outage.
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
  const bucket = options.bucket ?? 'default'
  const key = `ratelimit:${prefix}:${bucket}:${identifier}`

  const { upstash } = config.rateLimit
  if (!upstash.enabled && (upstash.url || upstash.token) && !warnedHalfConfig) {
    warnedHalfConfig = true
    logger.warn(
      'Only one of UPSTASH_REDIS_URL / UPSTASH_REDIS_TOKEN is set; rate limiting stays per-instance'
    )
  }
  if (upstash.enabled && upstash.url && upstash.token) {
    try {
      return await checkRateLimitUpstash(key, windowMs, maxRequests, {
        url: upstash.url,
        token: upstash.token
      })
    } catch (err) {
      const now = Date.now()
      if (now - lastUpstashWarnAt >= UPSTASH_WARN_INTERVAL_MS) {
        lastUpstashWarnAt = now
        // Only our own messages are logged: a fetch TypeError can quote the
        // whole request URL.
        logger.warn({
          msg: 'Upstash rate limit failed; falling back to in-memory',
          errName: err instanceof Error ? err.name : typeof err,
          ...(err instanceof UpstashError ? { err: err.message } : {})
        })
      }
    }
  }

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
    headers.set(
      'Retry-After',
      Math.max(1, result.reset - Math.floor(Date.now() / 1000)).toString()
    )
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

/**
 * Rate-limiting middleware for API routes. Logs at `warn` and throws when the
 * caller exceeds their bucket; otherwise returns the bucket metadata so the
 * handler can attach `X-RateLimit-*` headers via {@link applyRateLimitHeaders}.
 *
 * @throws {TooManyRequestsError} When the bucket for this identifier is exhausted.
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

    throw new TooManyRequestsError(
      'Rate limit exceeded. Please try again later.',
      {
        retryAfter,
        details: {
          limit: result.limit,
          reset: result.reset
        }
      }
    )
  }

  return result
}

/**
 * Preset rate limit configurations for different endpoint types
 */
export const RateLimitPresets = {
  /** Standard public endpoints (60 req/min) */
  public: { bucket: 'public' } as RateLimitOptions,

  /** Authentication endpoints (10 req/min) */
  auth: {
    bucket: 'auth',
    maxRequests: 10,
    maxRequestsAuth: 30
  } as RateLimitOptions,

  /** Sensitive operations (5 req/min) */
  sensitive: {
    bucket: 'sensitive',
    maxRequests: 5,
    maxRequestsAuth: 20
  } as RateLimitOptions,

  /** Card scan callbacks (high volume, 200 req/min) */
  cardScan: {
    bucket: 'cardScan',
    maxRequests: 200,
    maxRequestsAuth: 500
  } as RateLimitOptions,

  /** LUD16 lookups (high volume, 120 req/min) */
  lud16: {
    bucket: 'lud16',
    maxRequests: 120,
    maxRequestsAuth: 300
  } as RateLimitOptions
} as const
