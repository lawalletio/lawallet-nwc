import { getCurrentReqId } from '@/lib/logger'

/**
 * Sends a handled failure to Sentry. `handleApiError` only captures thrown
 * 5xx errors, so failures that are logged and answered gracefully (money
 * moved but no ledger row, a preimage mismatch, a reconcile pass that gave
 * up) never reached it. Pass the log key as a string when there is no Error.
 *
 * Gated on `SENTRY_DSN` the same way as `error-handler.ts`. Fire-and-forget:
 * reporting must never change the caller's outcome.
 */
export function reportError(
  err: unknown,
  area: string,
  level: 'error' | 'warning' = 'error'
): void {
  if (!process.env.SENTRY_DSN) return
  const error = typeof err === 'string' ? new Error(err) : err
  import('@sentry/nextjs')
    .then(Sentry =>
      Sentry.captureException(error, {
        level,
        tags: { area, reqId: getCurrentReqId() }
      })
    )
    .catch(() => {})
}
