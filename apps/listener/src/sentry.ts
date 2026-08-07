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
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend: scrubEvent
  })
  initialized = true
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
