/**
 * Browser-side Sentry init. Gated on NEXT_PUBLIC_SENTRY_DSN (build-inlined) —
 * without it, init never runs and no events are sent. Privacy: no Replay,
 * no user identification, and every event passes through the PII scrubber.
 */
import * as Sentry from '@sentry/nextjs'

import { scrubEvent } from '@/lib/observability/pii'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: event => scrubEvent(event)
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
