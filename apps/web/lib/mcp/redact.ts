/**
 * Strips secret material from tool results before they reach the model. An
 * NWC connection string is as good as the wallet's funds, and anything a model
 * reads can be exfiltrated by a prompt injection, so this is applied to every
 * result — REST-dispatched and native alike.
 *
 * Two independent nets:
 *  - by value: any string holding an NWC URI or an `nsec1…` key, wherever it
 *    sits (a nested field, an error message, a URL);
 *  - by key: values under keys that name secret material, whatever their
 *    format (hex keys, card keys, coupon codes, device keys).
 */

const NWC_URI = /nostr\+?walletconnect:/i
const NSEC = /nsec1[02-9ac-hj-np-z]{20,}/i
/** A card activation link: possession plus any account claims the card. */
const ACTIVATION_URL = /\/wallet\/activate\/[0-9a-f]{16,}/i

/** Normalized (lower-case, alphanumerics only) fragments of secret key names. */
const SECRET_KEY_FRAGMENTS = [
  'secret',
  'nsec',
  'privatekey',
  'connectionstring',
  'nwcstring',
  'nwcuri',
  'password',
  'mnemonic',
  'devicekey',
  'accesstoken',
  'refreshtoken'
]

/**
 * Exact (normalized) secret key names too short or generic for a fragment:
 * NTAG424 card keys, the card's one-time claim code, card activation tokens,
 * and a voucher's coupon code (bare, and inside its signed event's tags).
 */
const SECRET_KEYS = new Set([
  'k0',
  'k1',
  'k2',
  'k3',
  'k4',
  'otc',
  'nonce',
  'voucherevent',
  'tokenid',
  'qrpayload'
])

export const REDACTED = '[redacted]'

function isSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '')
  return (
    SECRET_KEYS.has(normalized) ||
    SECRET_KEY_FRAGMENTS.some(fragment => normalized.includes(fragment))
  )
}

// Flags such as `listener_secret_configured: 'true'` describe a secret without
// carrying it; a value like these can never be the secret itself.
function carriesSecret(value: unknown): boolean {
  if (typeof value === 'string') {
    return value !== '' && value !== 'true' && value !== 'false'
  }
  return typeof value === 'object' && value !== null
}

function redactString(value: string): string {
  if (NWC_URI.test(value)) return '[redacted NWC connection string]'
  if (NSEC.test(value)) return '[redacted nsec key]'
  if (ACTIVATION_URL.test(value)) return '[redacted card activation link]'
  return value
}

/** Deep copy of `value` with secrets replaced by redaction markers. */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redactSecrets)
  // Dates serialize through toJSON; walking their (empty) entries would lose them.
  if (typeof value !== 'object' || value === null || value instanceof Date) {
    return value
  }

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] =
      isSecretKey(key) && carriesSecret(item) ? REDACTED : redactSecrets(item)
  }
  return out
}
