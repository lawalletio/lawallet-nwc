import type { Dict } from './en'
import type { DestinationParseError } from '@/lib/client/nwc/parse-destination'
import type { LnurlError } from '@/lib/client/lnurl-scan'
import type { PasskeyError } from '@/lib/client/passkey-api'
import { nwcErrorKind } from '@/lib/client/nwc/errors'

/**
 * Localized text for an error thrown by a shared lib helper. The helpers stay
 * locale-free (/admin reuses them in English) and tag their own messages with
 * a stable code; untagged errors — server-, wallet- or LNURL-service-authored
 * text — pass through verbatim. Matches on `name`, not `instanceof`, so a
 * caller doesn't bundle every helper module.
 */
export function errorText(t: Dict, err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback
  if (err.name === 'DestinationParseError') {
    return t.errors.destination[(err as DestinationParseError).code]
  }
  if (err.name === 'LnurlError') {
    const { code, status = 0 } = err as LnurlError
    if (code) {
      const text = t.errors.lnurl[code]
      return typeof text === 'function' ? text(status) : text
    }
  }
  if (err.name === 'PasskeyError') {
    // `security`/`unknown` keep the raw (dev-facing or server) message.
    const { kind, fromServer } = err as PasskeyError
    if (!fromServer && kind in t.auth.passkeyErrors) {
      return t.auth.passkeyErrors[kind as keyof Dict['auth']['passkeyErrors']]
    }
  }
  return err.message || fallback
}

/** NWC request failures: relay/timeout kinds localized, wallet text verbatim. */
export function nwcErrorText(
  t: Dict,
  err: unknown,
  fallback = t.errors.nwc.generic
): string {
  const kind = nwcErrorKind(err)
  return kind ? t.errors.nwc[kind] : errorText(t, err, fallback)
}
