'use client'

import { bech32 } from 'bech32'

/**
 * Client-side LNURL classification + LNURL-withdraw claim, used by the wallet
 * scanner.
 *
 * The scanner needs to tell a **pay** endpoint (LUD-06 `payRequest`) apart from
 * a **withdraw** voucher (LUD-03 `withdrawRequest`), which is only knowable by
 * fetching the endpoint and reading its `tag`. `parseDestination` can't do this
 * (it's pure and assumes every `lnurl1…` is pay), so this module does the
 * network round-trip and routes accordingly.
 *
 * (Distinct from `lnurl.ts`, the LUD-21 verify poller, and `lnurl-invoice.ts`,
 * the pay-side invoice resolver.)
 */

export interface LnurlPayResolved {
  kind: 'pay'
  /** The LUD-06 endpoint the send flow re-fetches to mint an invoice. */
  lnurlpUrl: string
}

export interface LnurlWithdrawParams {
  /** Callback the wallet posts a bolt11 invoice to (LUD-03). */
  callback: string
  /** One-time secret echoed back to the callback. */
  k1: string
  /** Suggested memo for the minted invoice. */
  defaultDescription: string
  minWithdrawableSats: number
  maxWithdrawableSats: number
  /** Host of the withdraw endpoint, for display. */
  host: string
}

export interface LnurlWithdrawResolved {
  kind: 'withdraw'
  params: LnurlWithdrawParams
}

export type LnurlResolved = LnurlPayResolved | LnurlWithdrawResolved

export class LnurlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LnurlError'
  }
}

/**
 * Decodes any LNURL form to its http(s) endpoint, or returns `null` when the
 * input isn't an LNURL at all (so the caller can fall through to
 * `parseDestination`). Handles:
 *   - `lightning:` scheme prefix (stripped)
 *   - bech32 `lnurl1…`
 *   - `lnurlw://` / `lnurlp://` / `lnurlc://` / `keyauth://` pseudo-schemes
 *   - a plain `http(s)://…` LNURL endpoint (e.g. carrying `?tag=withdrawRequest`)
 */
export function lnurlToHttpUrl(input: string): string | null {
  let text = input.trim()
  if (!text) return null

  if (/^lightning:/i.test(text)) text = text.slice('lightning:'.length).trim()

  const lower = text.toLowerCase()

  // Pseudo-schemes: `.onion` hosts speak http, everything else https.
  const schemeMatch = lower.match(/^(lnurlw|lnurlp|lnurlc|keyauth):\/\//)
  if (schemeMatch) {
    const rest = text.slice(schemeMatch[0].length)
    const protocol = /^[^/]*\.onion(?::\d+)?(?:\/|$)/i.test(rest)
      ? 'http://'
      : 'https://'
    return `${protocol}${rest}`
  }

  if (lower.startsWith('lnurl1')) {
    try {
      const decoded = bech32.decode(text, 2048)
      const bytes = bech32.fromWords(decoded.words)
      const url = new TextDecoder().decode(Uint8Array.from(bytes))
      return /^https?:\/\//i.test(url) ? url : null
    } catch {
      return null
    }
  }

  if (/^https?:\/\//i.test(text)) return text

  return null
}

/**
 * Cheap, IO-free pre-check: does `input` look like an LNURL worth resolving?
 * The scanner uses this to avoid firing a network request at every plain
 * website QR — only bech32 `lnurl1…`, the LNURL pseudo-schemes, or an http(s)
 * URL that explicitly carries an LNURL signal (`tag`/`k1`) qualify. A plain
 * Lightning address (`user@host`) is intentionally excluded — it's pay-only and
 * `parseDestination` already handles it.
 */
export function looksLikeLnurl(input: string): boolean {
  let text = input.trim()
  if (/^lightning:/i.test(text)) text = text.slice('lightning:'.length).trim()
  const lower = text.toLowerCase()

  if (lower.startsWith('lnurl1')) return true
  if (/^(lnurlw|lnurlp|lnurlc|keyauth):\/\//.test(lower)) return true

  if (/^https?:\/\//.test(lower)) {
    try {
      const u = new URL(text)
      const tag = u.searchParams.get('tag')
      if (tag === 'withdrawRequest' || tag === 'payRequest') return true
      if (u.searchParams.has('k1')) return true
    } catch {
      return false
    }
  }

  return false
}

interface LnurlWithdrawResponse {
  tag?: string
  callback?: string
  k1?: string
  defaultDescription?: string
  minWithdrawable?: number
  maxWithdrawable?: number
  status?: string
  reason?: string
}

/**
 * Resolves an LNURL string to a typed pay/withdraw descriptor by fetching the
 * endpoint and branching on its `tag`. Throws {@link LnurlError} when the input
 * is a recognizable LNURL but the endpoint is unreachable / malformed / an
 * unsupported tag. Returns `null` only when `input` isn't an LNURL at all.
 */
export async function resolveLnurl(input: string): Promise<LnurlResolved | null> {
  const url = lnurlToHttpUrl(input)
  if (!url) return null

  let res: Response
  try {
    res = await fetch(url, { headers: { accept: 'application/json' } })
  } catch {
    throw new LnurlError('Could not reach the LNURL endpoint')
  }
  if (!res.ok) throw new LnurlError(`LNURL endpoint returned ${res.status}`)

  let json: LnurlWithdrawResponse
  try {
    json = (await res.json()) as LnurlWithdrawResponse
  } catch {
    throw new LnurlError('LNURL endpoint returned an invalid response')
  }

  if (json.status === 'ERROR') {
    throw new LnurlError(json.reason || 'LNURL endpoint returned an error')
  }

  if (json.tag === 'withdrawRequest') {
    return { kind: 'withdraw', params: parseWithdrawParams(json, url) }
  }

  if (json.tag === 'payRequest') {
    return { kind: 'pay', lnurlpUrl: url }
  }

  throw new LnurlError('Unsupported LNURL type')
}

function parseWithdrawParams(
  json: LnurlWithdrawResponse,
  endpointUrl: string,
): LnurlWithdrawParams {
  const callback = typeof json.callback === 'string' ? json.callback : ''
  const k1 = typeof json.k1 === 'string' ? json.k1 : ''
  if (!callback || !k1) {
    throw new LnurlError('Withdraw voucher is missing required fields')
  }

  const minMsat = Number(json.minWithdrawable ?? 0)
  const maxMsat = Number(json.maxWithdrawable ?? 0)
  if (!Number.isFinite(maxMsat) || maxMsat <= 0) {
    throw new LnurlError('Withdraw voucher has no withdrawable amount')
  }

  // Clamp to whole sats that stay INSIDE the msat bounds: round the floor up and
  // the ceiling down so a chosen sat amount never violates min/max after ×1000.
  const minWithdrawableSats = Math.ceil(Math.max(0, minMsat) / 1000)
  const maxWithdrawableSats = Math.floor(maxMsat / 1000)
  if (maxWithdrawableSats < 1) {
    throw new LnurlError('Withdrawable amount is below 1 sat')
  }

  let host = ''
  try {
    host = new URL(endpointUrl).host
  } catch {
    host = ''
  }

  return {
    callback,
    k1,
    defaultDescription:
      typeof json.defaultDescription === 'string' ? json.defaultDescription : '',
    minWithdrawableSats: Math.min(minWithdrawableSats, maxWithdrawableSats),
    maxWithdrawableSats,
    host,
  }
}

interface LnurlCallbackResponse {
  status?: string
  reason?: string
}

/**
 * Posts a minted bolt11 invoice to a withdraw callback (LUD-03). Resolves when
 * the service accepts the request (`{status:"OK"}`) — settlement is
 * asynchronous, so callers should watch the invoice for the incoming payment.
 * Throws {@link LnurlError} on `{status:"ERROR"}` or a transport failure.
 */
export async function submitLnurlWithdraw(
  callback: string,
  k1: string,
  bolt11: string,
): Promise<void> {
  let cbUrl: URL
  try {
    cbUrl = new URL(callback)
  } catch {
    throw new LnurlError('Withdraw voucher has an invalid callback URL')
  }
  cbUrl.searchParams.set('k1', k1)
  cbUrl.searchParams.set('pr', bolt11)

  let res: Response
  try {
    res = await fetch(cbUrl.toString(), { headers: { accept: 'application/json' } })
  } catch {
    throw new LnurlError('Could not reach the withdraw service')
  }
  if (!res.ok) {
    throw new LnurlError(`Withdraw service returned ${res.status}`)
  }

  const json = (await res.json().catch(() => null)) as LnurlCallbackResponse | null
  if (json?.status === 'ERROR') {
    throw new LnurlError(json.reason || 'The withdraw request was rejected')
  }
}
