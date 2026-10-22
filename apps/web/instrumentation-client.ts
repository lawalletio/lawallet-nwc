/**
 * Browser-side Sentry init. Gated on NEXT_PUBLIC_SENTRY_DSN (build-inlined) —
 * without it, init never runs and no events are sent. Privacy: no Replay,
 * no user identification, and every event passes through the PII scrubber.
 * Third-party noise (extensions, Vercel Live toolbar) is dropped first.
 */
import * as Sentry from '@sentry/nextjs'

import {
  DENY_URLS,
  IGNORE_ERRORS,
  isThirdPartyNoise
} from '@/lib/observability/noise'
import { scrubEvent } from '@/lib/observability/pii'
import {
  SENTRY_DATA_COLLECTION,
  SENTRY_TRACE_LIFECYCLE
} from '@/lib/observability/sentry-options'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  Sentry.init({
    dsn,
    // Same name the server reports (`VERCEL_ENV`); the SDK default here was
    // `vercel-production`, splitting one deployment across two environments.
    environment:
      process.env.NEXT_PUBLIC_VERCEL_ENV ??
      process.env.NODE_ENV ??
      'development',
    tracesSampleRate: 0.1,
    traceLifecycle: SENTRY_TRACE_LIFECYCLE,
    dataCollection: SENTRY_DATA_COLLECTION,
    ignoreErrors: IGNORE_ERRORS,
    denyUrls: DENY_URLS,
    beforeSend: event => (isThirdPartyNoise(event) ? null : scrubEvent(event)),
    beforeSendTransaction: event => scrubEvent(event)
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
