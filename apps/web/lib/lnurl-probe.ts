import { ValidationError } from '@/types/server/errors'

/**
 * LUD-16 / LUD-21 helpers shared by the invoice route and the settings probe.
 *
 * LUD-16: Lightning Address → metadata → callback → bolt11
 * LUD-21: payRequest callback may include a `verify` URL for payment polling
 *
 * Specs:
 * - https://github.com/lnurl/luds/blob/luds/16.md
 * - https://github.com/lnurl/luds/blob/luds/21.md
 */

const DEFAULT_TIMEOUT_MS = 8_000

export interface Lud16Metadata {
  tag: string
  callback: string
  minSendable: number
  maxSendable: number
  metadata?: string
}

export interface Lud16CallbackResponse {
  pr?: string
  verify?: string
  status?: string
  reason?: string
}

function fetchWithTimeout(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  )
}

function splitLightningAddress(lightningAddress: string): {
  username: string
  domain: string
} {
  const [username, domain] = lightningAddress.split('@')
  if (!username || !domain) {
    throw new ValidationError('Invalid lightning address format')
  }
  return { username, domain }
}

/**
 * Resolves a Lightning Address via LUD-16 and returns the metadata document.
 */
export async function fetchLud16Metadata(
  lightningAddress: string
): Promise<Lud16Metadata> {
  const { username, domain } = splitLightningAddress(lightningAddress)
  const metadataUrl = `https://${domain}/.well-known/lnurlp/${username}`

  let res: Response
  try {
    res = await fetchWithTimeout(metadataUrl)
  } catch (err) {
    throw new ValidationError(
      `Lightning address is not reachable (${err instanceof Error ? err.message : 'network error'})`
    )
  }

  if (!res.ok) {
    throw new ValidationError(
      `Lightning address returned HTTP ${res.status}`
    )
  }

  const metadata = (await res.json()) as Lud16Metadata
  if (metadata.tag !== 'payRequest' || !metadata.callback) {
    throw new ValidationError(
      'Lightning address is not a valid LUD-16 payRequest'
    )
  }
  return metadata
}

/**
 * Calls a LUD-16 `callback` endpoint for the given amount and optional comment.
 * Throws ValidationError on network, protocol, or provider-level errors.
 */
export async function callLud16Callback(
  callback: string,
  amountMsats: number,
  comment?: string
): Promise<Lud16CallbackResponse> {
  const separator = callback.includes('?') ? '&' : '?'
  const commentPart = comment ? `&comment=${encodeURIComponent(comment)}` : ''
  const url = `${callback}${separator}amount=${amountMsats}${commentPart}`

  let res: Response
  try {
    res = await fetchWithTimeout(url)
  } catch (err) {
    throw new ValidationError(
      `Lightning address callback failed (${err instanceof Error ? err.message : 'network error'})`
    )
  }
  if (!res.ok) {
    throw new ValidationError(
      `Lightning address callback returned HTTP ${res.status}`
    )
  }

  const data = (await res.json()) as Lud16CallbackResponse
  if (data.status === 'ERROR') {
    throw new ValidationError(
      `Lightning address rejected invoice: ${data.reason ?? 'unknown error'}`
    )
  }
  return data
}

/**
 * Resolves a Lightning Address via LUD-16 and generates a bolt11 invoice.
 * Returns the bolt11 and optional LUD-21 verify URL.
 *
 * Used by the real invoice route to mint user-facing invoices.
 */
export async function resolveInvoice(
  lightningAddress: string,
  amountSats: number,
  description: string
): Promise<{ bolt11: string; verify?: string }> {
  const metadata = await fetchLud16Metadata(lightningAddress)
  const amountMsats = amountSats * 1000

  if (
    amountMsats < metadata.minSendable ||
    amountMsats > metadata.maxSendable
  ) {
    throw new ValidationError(
      `Amount ${amountSats} sats is outside the allowed range (${metadata.minSendable / 1000}–${metadata.maxSendable / 1000} sats)`
    )
  }

  const data = await callLud16Callback(metadata.callback, amountMsats, description)
  if (!data.pr) {
    throw new ValidationError('No payment request returned from Lightning Address')
  }
  return { bolt11: data.pr, verify: data.verify }
}

/**
 * Probes whether a Lightning Address can be used for paid registration.
 *
 * Validates:
 * 1. LUD-16 metadata resolves and is a payRequest.
 * 2. The configured price is within [minSendable, maxSendable].
 * 3. The callback responds successfully and includes a LUD-21 `verify` URL.
 *
 * Uses `minSendable` (not `priceSats`) as the probe amount to avoid
 * generating a real invoice for the configured price on every save.
 *
 * Throws ValidationError with a specific, actionable message on failure.
 */
export async function probeLud21Support(
  lightningAddress: string,
  priceSats: number
): Promise<void> {
  const metadata = await fetchLud16Metadata(lightningAddress)
  const priceMsats = priceSats * 1000

  if (priceMsats < metadata.minSendable || priceMsats > metadata.maxSendable) {
    throw new ValidationError(
      `Price ${priceSats} sats is outside the sendable range for this address (${metadata.minSendable / 1000}–${metadata.maxSendable / 1000} sats)`
    )
  }

  const data = await callLud16Callback(
    metadata.callback,
    metadata.minSendable,
    'LaWallet LUD-21 probe'
  )
  if (!data.verify) {
    throw new ValidationError(
      'This Lightning Address does not expose a LUD-21 verify URL, which is required for paid registration. Use a provider that supports LUD-21 (e.g. LNbits, NWC).'
    )
  }
}
