import type { AnalyticsEventName } from './events'

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

export type EventParams = Record<string, string | number | boolean | undefined>

// Patterns for values we never want to send to a third party. Defense in
// depth — call sites should already pass categorical params only, but if a
// pubkey, npub, ln address, or NWC URI sneaks in, drop it here.
const PII_PATTERNS: RegExp[] = [
  /^npub1[ac-hj-np-z02-9]+$/i,
  /^nsec1[ac-hj-np-z02-9]+$/i,
  /^nostr\+walletconnect:\/\//i,
  /^nostr:/i,
  /^lnbc[0-9]/i,
  /^lnurl[0-9a-z]+$/i,
  /^[0-9a-f]{64}$/i, // bare 64-hex (Nostr pubkey / event id)
  /@[a-z0-9.-]+\.[a-z]{2,}$/i, // anything that looks like an email / ln address
]

function looksLikePII(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return PII_PATTERNS.some(p => p.test(value))
}

function sanitize(params: EventParams | undefined): EventParams | undefined {
  if (!params) return undefined
  const out: EventParams = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue
    if (looksLikePII(value)) {
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console
        console.warn(
          `[analytics] dropped PII-shaped value for param "${key}"`
        )
      }
      continue
    }
    out[key] = value
  }
  return out
}

/**
 * Fire a Google Analytics event. No-ops when `window.gtag` is undefined
 * (e.g. before the script loads, in tests, or when no `gtag_id` is set).
 *
 * Anonymity is enforced two ways: the `<GoogleAnalytics>` init script
 * configures `anonymize_ip` / `allow_google_signals=false` /
 * `allow_ad_personalization_signals=false`, and this helper strips any
 * PII-shaped values from the params before forwarding.
 */
export function trackEvent(
  name: AnalyticsEventName,
  params?: EventParams
): void {
  if (typeof window === 'undefined' || typeof window.gtag !== 'function') {
    return
  }
  window.gtag('event', name, sanitize(params))
}

/** Sensitive query keys we strip from `page_path` before reporting. */
const SENSITIVE_QUERY_KEYS = new Set([
  'invoice',
  'lnurl',
  'code',
  'token',
  'secret',
  'pubkey',
  'npub',
])

/**
 * Build a sanitized `page_path` for `page_view` events. Strips known
 * sensitive query parameters so things like LNURL strings never end up in
 * GA. Keeps the pathname plus the remaining query string.
 */
export function sanitizePagePath(
  pathname: string,
  searchParams?: URLSearchParams | null
): string {
  if (!searchParams) return pathname
  const sp = new URLSearchParams(searchParams)
  for (const key of SENSITIVE_QUERY_KEYS) {
    if (sp.has(key)) sp.delete(key)
  }
  const qs = sp.toString()
  return qs ? `${pathname}?${qs}` : pathname
}
