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

/**
 * Per-attempt budget and retry count for *minting a real invoice*. Kept apart
 * from the probe defaults: a probe runs while an operator watches a settings
 * form and should fail fast, while a mint sits between a user and the address
 * they are trying to buy — one slow provider response there is the difference
 * between "pay this QR" and a dead end at the 402.
 */
const MINT_TIMEOUT_MS = 7_000
const MINT_ATTEMPTS = 2
const RETRY_BACKOFF_MS = 300

export interface Lud16Metadata {
  tag: string
  callback: string
  minSendable: number
  maxSendable: number
  metadata?: string
  allowsNostr?: boolean
  nostrPubkey?: string
  commentAllowed?: number
}

export interface Lud16CallbackResponse {
  pr?: string
  verify?: string
  status?: string
  reason?: string
}

export type LightningAddressProbeKey = 'lud16' | 'lud21' | 'nip57' | 'lud12'

export interface LightningAddressProbeCheck {
  ok: boolean
  message: string
}

export interface LightningAddressProbeResult {
  address: string
  canSave: boolean
  checks: Record<LightningAddressProbeKey, LightningAddressProbeCheck>
}

export interface LnurlFetchOptions {
  /** Per-attempt timeout. */
  timeoutMs?: number
  /** Total attempts, including the first. `1` disables retrying. */
  attempts?: number
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

/**
 * A response worth a second attempt: the provider is up but momentarily
 * unable to answer. 4xx (other than 429) is a verdict, not a hiccup, so it
 * is returned to the caller as-is.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * `fetchWithTimeout` plus a bounded retry for transient failures — a timed-out
 * connection, a dropped socket, a 429/5xx. Lightning Address providers are
 * third-party servers with wildly variable latency, and a single slow response
 * used to abort the whole paid-registration flow, leaving the user stuck on
 * the 402 with no way to pay.
 *
 * Only the last attempt's failure is surfaced, so error messages stay the same
 * shape callers already match on.
 */
async function fetchWithRetry(
  url: string,
  options: LnurlFetchOptions = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, attempts = 1 } = options
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, timeoutMs)
      if (attempt < attempts && isRetryableStatus(res.status)) {
        await delay(RETRY_BACKOFF_MS)
        continue
      }
      return res
    } catch (err) {
      lastError = err
      if (attempt < attempts) await delay(RETRY_BACKOFF_MS)
    }
  }

  throw lastError
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

function probeFailureMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function assertSendableRange(metadata: Lud16Metadata): void {
  if (
    !Number.isFinite(metadata.minSendable) ||
    !Number.isFinite(metadata.maxSendable) ||
    metadata.minSendable <= 0 ||
    metadata.maxSendable < metadata.minSendable
  ) {
    throw new ValidationError('Lightning address has an invalid sendable range')
  }
}

export function isHexPubkey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}

function ok(message: string): LightningAddressProbeCheck {
  return { ok: true, message }
}

function invalid(message: string): LightningAddressProbeCheck {
  return { ok: false, message }
}

/**
 * Resolves a Lightning Address via LUD-16 and returns the metadata document.
 */
export async function fetchLud16Metadata(
  lightningAddress: string,
  options: LnurlFetchOptions = {}
): Promise<Lud16Metadata> {
  const { username, domain } = splitLightningAddress(lightningAddress)
  const metadataUrl = `https://${domain}/.well-known/lnurlp/${username}`

  let res: Response
  try {
    res = await fetchWithRetry(metadataUrl, options)
  } catch (err) {
    throw new ValidationError(
      `Lightning address is not reachable (${err instanceof Error ? err.message : 'network error'})`
    )
  }

  if (!res.ok) {
    throw new ValidationError(`Lightning address returned HTTP ${res.status}`)
  }

  const metadata = (await res.json()) as Lud16Metadata
  if (metadata.tag !== 'payRequest' || !metadata.callback) {
    throw new ValidationError(
      'Lightning address is not a valid LUD-16 payRequest'
    )
  }
  return metadata
}

export interface Lud16CallbackOptions extends LnurlFetchOptions {
  /**
   * The provider's advertised LUD-12 `commentAllowed` budget. Omitted (or 0)
   * means the provider accepts no comment at all.
   */
  commentAllowed?: number
}

/**
 * Trims a comment to what the provider said it accepts (LUD-12). Returns
 * `undefined` when the budget is missing, zero, or invalid — sending a
 * `comment` param to a provider that never advertised one is a spec violation
 * that real implementations answer with an HTTP 400, which used to surface as
 * "Lightning address callback returned HTTP 400" mid-registration.
 *
 * See: https://github.com/lnurl/luds/blob/luds/12.md
 */
function commentWithinBudget(
  comment: string | undefined,
  commentAllowed: number | undefined
): string | undefined {
  if (!comment) return undefined
  if (!Number.isFinite(commentAllowed) || (commentAllowed ?? 0) <= 0) {
    return undefined
  }
  return comment.slice(0, commentAllowed) || undefined
}

/**
 * Calls a LUD-16 `callback` endpoint for the given amount and optional comment.
 * The comment is only sent when the provider advertises a LUD-12 budget for it
 * (`options.commentAllowed`), truncated to fit.
 * Throws ValidationError on network, protocol, or provider-level errors.
 */
export async function callLud16Callback(
  callback: string,
  amountMsats: number,
  comment?: string,
  options: Lud16CallbackOptions = {}
): Promise<Lud16CallbackResponse> {
  const { commentAllowed, ...fetchOptions } = options
  const sendable = commentWithinBudget(comment, commentAllowed)
  const separator = callback.includes('?') ? '&' : '?'
  const commentPart = sendable
    ? `&comment=${encodeURIComponent(sendable)}`
    : ''
  const url = `${callback}${separator}amount=${amountMsats}${commentPart}`

  let res: Response
  try {
    res = await fetchWithRetry(url, fetchOptions)
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
  // Both legs retry: this is the only path between a user who just got a 402
  // and an invoice they can pay, so a single flaky round-trip must not end the
  // registration.
  const mintOptions = {
    timeoutMs: MINT_TIMEOUT_MS,
    attempts: MINT_ATTEMPTS
  }
  const metadata = await fetchLud16Metadata(lightningAddress, mintOptions)
  const amountMsats = amountSats * 1000

  if (
    amountMsats < metadata.minSendable ||
    amountMsats > metadata.maxSendable
  ) {
    throw new ValidationError(
      `Amount ${amountSats} sats is outside the allowed range (${metadata.minSendable / 1000}–${metadata.maxSendable / 1000} sats)`
    )
  }

  const data = await callLud16Callback(
    metadata.callback,
    amountMsats,
    description,
    { ...mintOptions, commentAllowed: metadata.commentAllowed }
  )
  if (!data.pr) {
    throw new ValidationError(
      'No payment request returned from Lightning Address'
    )
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
  assertSendableRange(metadata)
  const priceMsats = priceSats * 1000

  if (priceMsats < metadata.minSendable || priceMsats > metadata.maxSendable) {
    throw new ValidationError(
      `Price ${priceSats} sats is outside the sendable range for this address (${metadata.minSendable / 1000}–${metadata.maxSendable / 1000} sats)`
    )
  }

  const data = await callLud16Callback(
    metadata.callback,
    metadata.minSendable,
    'LaWallet LUD-21 probe',
    { commentAllowed: metadata.commentAllowed }
  )
  if (!data.verify) {
    throw new ValidationError(
      'This Lightning Address does not expose a LUD-21 verify URL, which is required for paid registration. Use a provider that supports LUD-21 (e.g. LNbits, NWC).'
    )
  }
}

/**
 * Probes a candidate alias target before a Lightning Address is put into ALIAS
 * mode. LUD-16 is the hard gate; LUD-21 and NIP-57 are capability signals that
 * the UI can surface without blocking a basic forwarding alias.
 */
export async function probeLightningAddressCapabilities(
  lightningAddress: string
): Promise<LightningAddressProbeResult> {
  const address = lightningAddress.trim().toLowerCase()
  const metadataPromise = fetchLud16Metadata(address)

  const lud16 = metadataPromise
    .then(metadata => {
      assertSendableRange(metadata)
      return ok('LUD-16 payRequest metadata resolved.')
    })
    .catch(err =>
      invalid(probeFailureMessage(err, 'LUD-16 metadata could not be resolved'))
    )

  const lud21 = metadataPromise
    .then(async metadata => {
      assertSendableRange(metadata)
      const data = await callLud16Callback(
        metadata.callback,
        metadata.minSendable,
        'LaWallet alias probe',
        { commentAllowed: metadata.commentAllowed }
      )

      if (!data.pr) {
        throw new ValidationError('Callback did not return a payment request')
      }
      if (!data.verify) {
        throw new ValidationError('Callback did not expose a LUD-21 verify URL')
      }

      return ok('LUD-21 verify URL is available.')
    })
    .catch(err =>
      invalid(probeFailureMessage(err, 'LUD-21 verify could not be confirmed'))
    )

  const nip57 = metadataPromise
    .then(metadata => {
      if (metadata.allowsNostr !== true) {
        throw new ValidationError('NIP-57 zaps are not advertised')
      }
      if (!isHexPubkey(metadata.nostrPubkey)) {
        throw new ValidationError('NIP-57 nostrPubkey is missing or invalid')
      }
      return ok('NIP-57 zap metadata is advertised.')
    })
    .catch(err =>
      invalid(probeFailureMessage(err, 'NIP-57 support could not be confirmed'))
    )

  // LUD-12 is advertised directly in the payRequest as a comment budget.
  const lud12 = metadataPromise
    .then(metadata => {
      const allowed = metadata.commentAllowed ?? 0
      if (!Number.isFinite(allowed) || allowed <= 0) {
        throw new ValidationError('Payer comments are not accepted')
      }
      return ok(`Accepts payer comments up to ${allowed} characters.`)
    })
    .catch(err =>
      invalid(probeFailureMessage(err, 'LUD-12 support could not be confirmed'))
    )

  const [lud16Result, lud21Result, nip57Result, lud12Result] =
    await Promise.all([lud16, lud21, nip57, lud12])

  return {
    address,
    canSave: lud16Result.ok,
    checks: {
      lud16: lud16Result,
      lud21: lud21Result,
      nip57: nip57Result,
      lud12: lud12Result
    }
  }
}
