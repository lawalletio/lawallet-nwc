/**
 * Third-party noise filter for browser Sentry events. Sentry's `denyUrls`
 * only checks the top stack frame, but when an injected script throws inside
 * an event listener the top frame is Sentry's own `addEventListener` wrapper
 * in our chunk, and the culprit sits below it. So scan every frame.
 */

/** Sentry `ignoreErrors`: matched against `<type>: <value>`. */
export const IGNORE_ERRORS: RegExp[] = [
  // MetaMask extension (LAWALLET-WEB-8); we never talk to MetaMask.
  /Failed to connect to MetaMask/
]

/** Sentry `denyUrls`: matched against the top frame's URL. */
export const DENY_URLS: RegExp[] = [/^(chrome|moz|safari-web)-extension:\/\//]

// Vercel Live feedback toolbar, injected on preview/beta deployments.
const THIRD_PARTY_FRAME = /\/_next-live\//

/** Structural subset of a Sentry event — keeps this module Sentry-free. */
type SentryEventLike = {
  exception?: {
    values?: { stacktrace?: { frames?: { filename?: string }[] } }[]
  }
}

/** True when any exception frame comes from a known third-party script. */
export function isThirdPartyNoise(event: SentryEventLike): boolean {
  return (event.exception?.values ?? []).some(ex =>
    (ex.stacktrace?.frames ?? []).some(
      frame => !!frame.filename && THIRD_PARTY_FRAME.test(frame.filename)
    )
  )
}
