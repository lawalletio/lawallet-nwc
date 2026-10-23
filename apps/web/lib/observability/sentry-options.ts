/**
 * Sentry options shared by the server (`instrumentation.ts`) and browser
 * (`instrumentation-client.ts`) inits. Kept Sentry-free (plain objects) so
 * importing it never pulls the SDK in when no DSN is set.
 *
 * Sentry v11 dropped `sendDefaultPii` and made an unset `dataCollection`
 * collect EVERYTHING (cookies, bodies, query strings, headers, local
 * variables). This restores — and tightens — the v10 `sendDefaultPii: false`
 * baseline: cookies and bodies carry JWTs / NIP-98 events, query strings can
 * carry LNURL `k1` / activation tokens, and stack-frame locals can hold nsecs.
 */
import type { BrowserOptions } from '@sentry/nextjs'

export const SENTRY_DATA_COLLECTION: NonNullable<
  BrowserOptions['dataCollection']
> = {
  userInfo: false,
  cookies: false,
  httpBodies: [],
  httpHeaders: { allow: ['user-agent'] },
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false
}

// v11 defaults to span streaming, where `beforeSendTransaction` (our
// `scrubEvent` hook for transactions) is never invoked. 'static' keeps the
// v10 transaction model so every transaction still passes the scrubber.
// ponytail: static mode is slated for removal in Sentry v12 — port the
// scrubber to `beforeSendSpan` + `ignoreSpans` before that upgrade.
export const SENTRY_TRACE_LIFECYCLE = 'static' as const
