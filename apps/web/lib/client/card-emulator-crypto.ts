/**
 * Browser-side helpers for the card emulator.
 *
 * SUN signing now happens **server-side** (`POST /api/cards/[id]/emulate-tap`)
 * so a card's `k1`/`k2` keys never reach the browser. This module is left with
 * only the non-sensitive URL/UID helpers the emulator UI still needs.
 */

export interface TapPC {
  /** Encrypted PICC data — 32 uppercase hex chars. */
  p: string
  /** SDMMAC — 16 uppercase hex chars. */
  c: string
}

export function bytesToHexUpper(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** Build the BoltCard scan URL a tap would resolve to. */
export function buildScanUrl(
  baseUrl: string,
  cardId: string,
  pc: TapPC
): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/cards/${cardId}/scan?p=${pc.p}&c=${pc.c}`
}

export interface PayLinkCheck {
  ok: boolean
  /** The raw `payLink` when the scan body included a string. */
  payLink?: string
  reason: string
}

/**
 * LUD-19 check for a card scan body. `payLink` must be a raw `lnurlp://` URL
 * (not bech32) whose path is this card's LNURL-pay endpoint.
 */
export function inspectPayLink(body: unknown, cardId: string): PayLinkCheck {
  if (!body || typeof body !== 'object') {
    return { ok: false, reason: 'Scan response is not an object' }
  }
  const payLink = (body as { payLink?: unknown }).payLink
  if (payLink === undefined) {
    return { ok: false, reason: 'payLink is missing from the scan response' }
  }
  if (typeof payLink !== 'string' || payLink.length === 0) {
    return { ok: false, reason: 'payLink is not a string' }
  }
  if (/^lnurl1/i.test(payLink)) {
    return {
      ok: false,
      payLink,
      reason: 'payLink is bech32; LUD-19 requires a raw lnurlp:// URL'
    }
  }
  if (!payLink.startsWith('lnurlp://')) {
    return { ok: false, payLink, reason: 'payLink must start with lnurlp://' }
  }
  if (payLink.toLowerCase().includes('lud16')) {
    return {
      ok: false,
      payLink,
      reason: 'payLink points at a Lightning Address, not the card'
    }
  }
  let url: URL
  try {
    url = new URL(`https://${payLink.slice('lnurlp://'.length)}`)
  } catch {
    return { ok: false, payLink, reason: 'payLink is not a valid URL' }
  }
  const expected = `/api/cards/${cardId}/lnurlp`
  if (url.pathname !== expected) {
    return {
      ok: false,
      payLink,
      reason: `payLink path is ${url.pathname}, expected ${expected}`
    }
  }
  return {
    ok: true,
    payLink,
    reason: 'payLink is a card-scoped lnurlp:// URL'
  }
}

/**
 * Turn a raw LUD-17 `lnurlp://` link into a URL the emulator can fetch.
 * Same host as the page keeps the page scheme (so localhost stays http).
 */
export function payLinkFetchUrl(payLink: string, pageOrigin: string): string {
  const httpsUrl = new URL(`https://${payLink.slice('lnurlp://'.length)}`)
  const page = new URL(pageOrigin)
  if (httpsUrl.host === page.host) httpsUrl.protocol = page.protocol
  return httpsUrl.toString()
}

/** LUD-06 payRequest reached by following a card `payLink`. */
export function inspectPayRequest(body: unknown, cardId: string): PayLinkCheck {
  if (!body || typeof body !== 'object') {
    return { ok: false, reason: 'payLink response is not an object' }
  }
  const pay = body as {
    tag?: unknown
    callback?: unknown
    status?: unknown
    reason?: unknown
  }
  if (pay.status === 'ERROR') {
    return {
      ok: false,
      reason:
        typeof pay.reason === 'string' ? pay.reason : 'payLink returned ERROR'
    }
  }
  if (pay.tag !== 'payRequest') {
    return { ok: false, reason: 'payLink did not return a payRequest' }
  }
  if (typeof pay.callback !== 'string') {
    return { ok: false, reason: 'payRequest is missing a callback' }
  }
  const expected = `/api/cards/${cardId}/lnurlp/cb`
  if (!pay.callback.includes(expected)) {
    return {
      ok: false,
      reason: `callback does not target ${expected}`
    }
  }
  return { ok: true, reason: 'payLink resolves to a card payRequest' }
}

/** Generate a random 7-byte NTAG424-style UID as uppercase hex (NXP prefix 0x04). */
export function randomUid(): string {
  const uid = new Uint8Array(7)
  globalThis.crypto.getRandomValues(uid)
  uid[0] = 0x04
  return bytesToHexUpper(uid)
}
