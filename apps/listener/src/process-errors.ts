import type { Logger } from 'pino'

const DEFAULT_WINDOW_MS = 60_000
const MAX_TRACKED_ERRORS = 100

interface ErrorBucket {
  lastLoggedAt: number
  suppressed: number
}

interface ProcessErrorReporterOptions {
  windowMs?: number
  now?: () => number
}

interface LogThrottleOptions extends ProcessErrorReporterOptions {
  maxTracked?: number
}

/** Returns the number of suppressed duplicates, or null when this one waits. */
export function createLogThrottle(
  options: LogThrottleOptions = {}
): (key: string) => number | null {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
  const now = options.now ?? Date.now
  const maxTracked = options.maxTracked ?? MAX_TRACKED_ERRORS
  const buckets = new Map<string, ErrorBucket>()

  return key => {
    const timestamp = now()
    const bucket = buckets.get(key)
    if (bucket && timestamp - bucket.lastLoggedAt < windowMs) {
      bucket.suppressed++
      return null
    }

    const suppressed = bucket?.suppressed ?? 0
    if (!bucket && buckets.size >= maxTracked) {
      const oldest = buckets.keys().next().value
      if (oldest) buckets.delete(oldest)
    }
    buckets.set(key, { lastLoggedAt: timestamp, suppressed: 0 })
    return suppressed
  }
}

/**
 * Prevents a reconnecting dependency from turning repeated process-level
 * errors into an event-loop and source-map formatting storm. Bare rejection
 * values deliberately remain strings: wrapping every one in a new Error would
 * capture and format a fresh stack for an error that originated elsewhere.
 */
export function createProcessErrorReporter(
  log: Pick<Logger, 'error'>,
  options: ProcessErrorReporterOptions = {}
): (
  kind: 'unhandled_rejection' | 'uncaught_exception',
  reason: unknown
) => void {
  const take = createLogThrottle(options)

  return (kind, reason) => {
    const normalized = normalizeReason(reason)
    const key = `${kind}:${normalized.key}`
    const suppressed = take(key)
    if (suppressed === null) return

    const context = normalized.error
      ? { err: normalized.error, suppressed }
      : { reason: normalized.message, suppressed }
    log.error(context, `process.${kind}`)
  }
}

function normalizeReason(reason: unknown): {
  key: string
  message: string
  error?: Error
} {
  if (reason instanceof Error) {
    const code = (reason as Error & { code?: unknown }).code
    const suffix = typeof code === 'string' ? `:${code}` : ''
    return {
      key: `${reason.name}:${reason.message}${suffix}`,
      message: reason.message,
      error: reason
    }
  }

  const message = safeString(reason)
  return { key: message, message }
}

function safeString(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
