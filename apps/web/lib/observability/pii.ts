/**
 * Shared PII patterns for Nostr/Lightning secrets. Dependency-free and
 * isomorphic (client + server). Two shapes on purpose:
 *
 * - `PII_PATTERNS` — whole-value tests ("does this param LOOK like PII?"),
 *   used by the analytics filter in `lib/analytics/gtag.ts`.
 * - `scrubPii` / `scrubEvent` — substring redaction for free text going to
 *   Sentry, where secrets are embedded inside messages and URLs.
 */

export const PII_PATTERNS: RegExp[] = [
  /^npub1[ac-hj-np-z02-9]+$/i,
  /^nsec1[ac-hj-np-z02-9]+$/i,
  /^nostr\+walletconnect:\/\//i,
  /^nostr:/i,
  /^lnbc[0-9]/i,
  /^lnurl[0-9a-z]+$/i,
  /^[0-9a-f]{64}$/i, // bare 64-hex (Nostr pubkey / event id)
  /@[a-z0-9.-]+\.[a-z]{2,}$/i // anything that looks like an email / ln address
]

// Substring patterns for scrubbing free text. The NWC pattern consumes the
// ENTIRE URI including the query string (relay + secret), not just the
// scheme. Bech32 patterns require a long tail so literal words like
// "lnurlp" in route paths survive.
const SCRUB_PATTERNS: RegExp[] = [
  /nostr\+walletconnect:\/\/[^\s"']+/gi,
  /nostr:[^\s"']+/gi,
  /nsec1[ac-hj-np-z02-9]+/gi,
  /npub1[ac-hj-np-z02-9]+/gi,
  /\blnbc[0-9a-z]{20,}/gi,
  /\blnurl1[ac-hj-np-z02-9]+/gi,
  /\b[0-9a-f]{64}\b/gi,
  /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi
]

export function scrubPii(text: string): string {
  let out = text
  for (const pattern of SCRUB_PATTERNS) {
    out = out.replace(pattern, '[redacted]')
  }
  return out
}

/** Structural subset of a Sentry event — keeps this module Sentry-free. */
type SentryEventLike = {
  message?: string
  transaction?: string
  exception?: { values?: { value?: string }[] }
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[]
  request?: { url?: string; query_string?: unknown }
  spans?: { description?: string }[]
}

/** Sentry `beforeSend`-compatible scrubber. Mutates and returns the event. */
export function scrubEvent<T extends SentryEventLike>(event: T): T {
  if (event.message) event.message = scrubPii(event.message)
  if (event.transaction) event.transaction = scrubPii(event.transaction)
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubPii(ex.value)
  }
  for (const crumb of event.breadcrumbs ?? []) {
    if (crumb.message) crumb.message = scrubPii(crumb.message)
    for (const [key, value] of Object.entries(crumb.data ?? {})) {
      if (typeof value === 'string') crumb.data![key] = scrubPii(value)
    }
  }
  if (event.request?.url) event.request.url = scrubPii(event.request.url)
  if (typeof event.request?.query_string === 'string') {
    event.request.query_string = scrubPii(event.request.query_string)
  }
  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrubPii(span.description)
  }
  return event
}
