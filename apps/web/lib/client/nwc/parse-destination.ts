import { decode } from 'light-bolt11-decoder'
import { bech32 } from 'bech32'

export interface InvoiceDestination {
  kind: 'invoice'
  bolt11: string
  amountSats: number | null
  description: string | null
  paymentHash: string | null
  expiresAt: number | null
}

export interface LnAddressDestination {
  kind: 'lnurl-pay'
  /** Raw address as typed, e.g. `satoshi@example.com`. */
  address: string
  username: string
  host: string
  /** LUD-16 .well-known URL to resolve. */
  lnurlpUrl: string
}

export interface LnurlDestination {
  kind: 'lnurl-pay'
  /** Decoded URL from bech32 `lnurl1…`. */
  lnurlpUrl: string
  address: null
  username: null
  host: null
}

export interface NpubDestination {
  kind: 'npub'
  npub: string
}

export type ParsedDestination =
  | InvoiceDestination
  | LnAddressDestination
  | LnurlDestination
  | NpubDestination

export class DestinationParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DestinationParseError'
  }
}

/**
 * Strips a `lightning:` scheme if present and trims whitespace.
 * Many wallets share payment requests prefixed with the scheme.
 */
function normalize(input: string): string {
  const trimmed = input.trim()
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('lightning:')) return trimmed.slice('lightning:'.length)
  return trimmed
}

const LN_ADDRESS_RE = /^([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i

/**
 * Parses an arbitrary user-supplied recipient string into a typed destination.
 * Pure — performs no network IO. Use the returned URLs / identifiers with
 * the payment helpers to actually complete the flow.
 *
 * Priority:
 *   1. bolt11 (`lnbc…` / `lntb…` / `lnbcrt…`)
 *   2. bech32 `lnurl1…`
 *   3. LUD-16 lightning address `user@host`
 *   4. bech32 `npub1…` (future — returns descriptor, payment not yet wired)
 */
export function parseDestination(rawInput: string): ParsedDestination {
  const input = normalize(rawInput)
  if (!input) throw new DestinationParseError('Enter a recipient')

  const lower = input.toLowerCase()

  if (/^ln(bc|tb|bcrt)/.test(lower)) {
    return parseBolt11(input)
  }

  if (lower.startsWith('lnurl1')) {
    return parseLnurl(input)
  }

  if (LN_ADDRESS_RE.test(input)) {
    return parseLnAddress(input)
  }

  if (lower.startsWith('npub1')) {
    return { kind: 'npub', npub: input }
  }

  throw new DestinationParseError(
    'Unsupported recipient. Use a Lightning address, bolt11 invoice, or LNURL.',
  )
}

function parseBolt11(bolt11: string): InvoiceDestination {
  let decoded: ReturnType<typeof decode>
  try {
    decoded = decode(bolt11)
  } catch {
    throw new DestinationParseError('Invalid Lightning invoice')
  }

  let amountSats: number | null = null
  let description: string | null = null
  let paymentHash: string | null = null
  let expiresAt: number | null = null

  for (const section of decoded.sections) {
    if (section.name === 'amount') {
      const msats = Number(section.value)
      if (Number.isFinite(msats) && msats > 0) {
        amountSats = Math.floor(msats / 1000)
      }
    } else if (section.name === 'description') {
      description = typeof section.value === 'string' ? section.value : null
    } else if (section.name === 'payment_hash') {
      paymentHash = typeof section.value === 'string' ? section.value : null
    } else if (section.name === 'timestamp' && typeof section.value === 'number') {
      const expiryRaw = decoded.expiry
      const expirySecs = typeof expiryRaw === 'number' ? expiryRaw : 3600
      expiresAt = (section.value + expirySecs) * 1000
    }
  }

  return {
    kind: 'invoice',
    bolt11,
    amountSats,
    description,
    paymentHash,
    expiresAt,
  }
}

function parseLnurl(lnurl: string): LnurlDestination {
  try {
    const decoded = bech32.decode(lnurl, 2048)
    const bytes = bech32.fromWords(decoded.words)
    const url = new TextDecoder().decode(Uint8Array.from(bytes))
    if (!/^https?:\/\//i.test(url)) {
      throw new Error('Decoded LNURL is not an HTTP(S) URL')
    }
    return {
      kind: 'lnurl-pay',
      lnurlpUrl: url,
      address: null,
      username: null,
      host: null,
    }
  } catch {
    throw new DestinationParseError('Invalid LNURL')
  }
}

function parseLnAddress(address: string): LnAddressDestination {
  const match = address.match(LN_ADDRESS_RE)
  if (!match) throw new DestinationParseError('Invalid Lightning address')
  const [, username, host] = match
  const lnurlpUrl = `https://${host}/.well-known/lnurlp/${encodeURIComponent(username)}`
  return {
    kind: 'lnurl-pay',
    address,
    username,
    host,
    lnurlpUrl,
  }
}
