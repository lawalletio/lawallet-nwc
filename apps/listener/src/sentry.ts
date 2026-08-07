// Optional, DSN-gated Sentry error reporting. With no SENTRY_DSN set every
// export is a no-op. Errors-only: no tracing, no PII.
import * as Sentry from '@sentry/node'
import type { ListenerEnv } from './env'

let initialized = false

// ponytail: small duplicate of the web app's scrub list — packages/shared is
// schemas-only, share it there if a third copy ever appears.
const PII_PATTERNS: RegExp[] = [
  /nostr\+walletconnect:\/\/[^\s"']+/gi,
  /nsec1[a-z0-9]+/gi,
  /npub1[a-z0-9]+/gi,
  /lnbc[a-z0-9]+/gi,
  /lnurl[a-z0-9]+/gi,
  /\b[0-9a-f]{64}\b/gi,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g
]

function scrub(text: string): string {
  return PII_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, '[redacted]'),
    text
  )
}

function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  if (event.message) event.message = scrub(event.message)
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrub(exception.value)
  }
  for (const breadcrumb of event.breadcrumbs ?? []) {
    if (breadcrumb.message) breadcrumb.message = scrub(breadcrumb.message)
  }
  return event
}

export function initSentry(env: ListenerEnv): void {
  if (!env.SENTRY_DSN) return
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'production',
    release: env.SENTRY_RELEASE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent
  })
  initialized = true

  // Release health: the SDK's default processSession integration already
  // opened a session for this process run, but it only transmits one that
  // ended badly. Send the healthy one now so the run lands in the denominator
  // of the crash-free rate — without it Sentry sees crashes and no baseline.
  // (Health needs `release` above; sessions alone are not enough.)
  Sentry.captureSession()
}

/**
 * Close the current process run as a clean exit.
 *
 * The integration's own hook runs on `beforeExit`, which a graceful shutdown
 * never reaches — it calls process.exit() directly.
 */
export function endSentrySession(): void {
  if (!initialized) return
  try {
    Sentry.endSession()
  } catch {
    // best-effort on shutdown
  }
}

export function captureException(
  err: unknown,
  ctx?: { tags?: Record<string, string> }
): void {
  if (!initialized) return
  try {
    Sentry.captureException(err, ctx)
  } catch {
    // reporting must never take the daemon down
  }
}

export async function flushSentry(timeoutMs: number): Promise<void> {
  if (!initialized) return
  try {
    await Sentry.flush(timeoutMs)
  } catch {
    // best-effort on shutdown
  }
}
