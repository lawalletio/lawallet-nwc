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

/**
 * Bearer-token routes whose dynamic URL segment alone grants access — no
 * `Authorization` header required. Segments on these routes must not be
 * persisted to Sentry `tags.path`, `request.url`, or the ActivityLog.
 * Replace them with the same `[param]` placeholder Next.js uses so the
 * operator can still group by route without leaking the credential.
 *
 * Why a list and not a generic regex: card `id`s (also 32-hex, same shape
 * as an OTC) are NOT bearer tokens — `/api/cards/[id]` requires auth and
 * surfacing them in Sentry is desirable for debugging. The route prefix is
 * the only discriminator. Add new bearer-token routes HERE.
 */
export const BEARER_TOKEN_PATH_PATTERNS: {
  match: RegExp
  replace: RegExp
  placeholder: string
}[] = [
  // /api/cards/otc/<OTC>  and  /api/cards/otc/<OTC>/activate
  {
    match: /^\/api\/cards\/otc\/[^/]+(\/|$)/,
    replace: /^(\/api\/cards\/otc)\/[^/]+/,
    placeholder: '[otc]'
  },
  // /api/remote-connections/<EDK>  and sub-routes (e.g. /cards)
  {
    match: /^\/api\/remote-connections\/[^/]+(\/|$)/,
    replace: /^(\/api\/remote-connections)\/[^/]+/,
    placeholder: '[externalDeviceKey]'
  },
  // /api/activation-tokens/<id>  and  /api/activation-tokens/<id>/claim
  // The id is randomBytes(16).toString('hex') — a scan-time capability:
  // possession + authentication transfers the card.
  {
    match: /^\/api\/activation-tokens\/[^/]+(\/|$)/,
    replace: /^(\/api\/activation-tokens)\/[^/]+/,
    placeholder: '[id]'
  }
]

/**
 * Returns a copy of `pathname` with bearer-token dynamic segments replaced
 * by their `[param]` placeholder. Non-matching paths come back unchanged.
 * `undefined` stays `undefined`.
 */
export function redactPathBearerTokens(
  pathname: string | undefined
): string | undefined {
  if (!pathname) return pathname
  for (const { match, replace, placeholder } of BEARER_TOKEN_PATH_PATTERNS) {
    if (match.test(pathname)) {
      return pathname.replace(replace, `$1/${placeholder}`)
    }
  }
  return pathname
}

/** Structural subset of a Sentry event — keeps this module Sentry-free. */
type SentryEventLike = {
  message?: string
  transaction?: string
  exception?: { values?: { value?: string }[] }
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[]
  request?: { url?: string; query_string?: unknown }
  spans?: { description?: string }[]
  // `tags` is a standard CaptureContext/Scope container the app populates via
  // `captureException(..., { tags })` and `setTag(...)`; left un-iterated it
  // would let any caller-side secret reach Sentry unredacted. `Record<string,
  // unknown>` because Sentry primitives include numbers/booleans/null, but
  // only string values are subject to substring scrubbing — same shape as
  // `breadcrumbs.data` above.
  tags?: Record<string, unknown>
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
  if (event.request?.url) {
    // First apply pattern-based scrubbing (Nostr/LN shapes), then apply
    // bearer-token path redaction so OTC / EDK / activation-token ids are
    // replaced with their [param] placeholder even though they don't match
    // the 64-hex Nostr key shape. Extract the pathname from the URL so the
    // route-prefix discriminator works correctly, then re-embed it.
    try {
      const parsed = new URL(event.request.url)
      parsed.pathname = redactPathBearerTokens(parsed.pathname) ?? parsed.pathname
      event.request.url = scrubPii(parsed.toString())
    } catch {
      event.request.url = scrubPii(event.request.url)
    }
  }
  if (typeof event.request?.query_string === 'string') {
    event.request.query_string = scrubPii(event.request.query_string)
  }
  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrubPii(span.description)
  }
  if (event.tags) {
    for (const [key, value] of Object.entries(event.tags)) {
      if (typeof value === 'string') event.tags[key] = scrubPii(value)
    }
  }
  return event
}
