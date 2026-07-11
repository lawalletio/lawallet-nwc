import { createHash, timingSafeEqual } from 'node:crypto'
import type pg from 'pg'
import type { Logger } from 'pino'
import { decode } from 'light-bolt11-decoder'
import type {
  NwcPaymentRequest,
  NwcPaymentResponse
} from '@lawallet-nwc/shared'
import type { Metrics } from '../metrics'
import {
  completeNwcRequest,
  computeNwcRequestPayloadHash,
  getNwcRequest,
  markNwcRequestDispatched,
  registerNwcRequest,
  type NwcRequestCompletion,
  type StoredNwcRequest
} from '../store'
import { NwcPool, NwcPoolError } from './pool'

const DEFAULT_READY_GRACE_MS = 750
const DEFAULT_TERMINAL_CACHE_MS = 5 * 60 * 1000

type RefreshWallet = (walletId: string) => Promise<boolean>

export interface NwcPaymentServiceDeps {
  pool: pg.Pool
  nwcPool: NwcPool
  log: Logger
  metrics: Metrics
  /** Targeted DB reload + pool reconcile, used when a new wallet was missed. */
  refreshWallet?: RefreshWallet
  readyGraceMs?: number
  terminalCacheMs?: number
}

interface InFlight {
  payloadHash: string
  promise: Promise<NwcPaymentResponse>
}

interface CachedTerminal {
  payloadHash: string
  response: NwcPaymentResponse
  expiresAt: number
}

/**
 * Exactly-once-within-the-listener payment coordinator. Postgres owns the
 * durable dispatch decision; the in-memory map only lets concurrent callers
 * share the original promise (and therefore its late SDK result).
 */
export class NwcPaymentService {
  private readonly deps: NwcPaymentServiceDeps
  private readonly inFlight = new Map<string, InFlight>()
  private readonly lookupFlights = new Map<string, Promise<void>>()
  private readonly terminalCache = new Map<string, CachedTerminal>()
  private terminalCacheSweep: NodeJS.Timeout | null = null

  constructor(deps: NwcPaymentServiceDeps) {
    this.deps = deps
  }

  submit(input: NwcPaymentRequest): Promise<NwcPaymentResponse> {
    const paymentHash = input.paymentHash.toLowerCase()
    const requestId = input.requestId.toLowerCase()
    const expectedId = computeNwcPaymentRequestId(input.walletId, paymentHash)
    if (!safeHexEqual(requestId, expectedId)) {
      return Promise.resolve({
        ok: false,
        status: 'rejected',
        requestId,
        error: {
          code: 'validation_error',
          message: 'requestId must be sha256(walletId|paymentHash)'
        }
      })
    }

    const invoicePaymentHash = paymentHashFromInvoice(input.invoice)
    if (invoicePaymentHash !== paymentHash) {
      return Promise.resolve({
        ok: false,
        status: 'rejected',
        requestId,
        error: {
          code: 'validation_error',
          message: invoicePaymentHash
            ? 'invoice payment hash does not match paymentHash'
            : 'invoice is malformed or has no payment hash'
        }
      })
    }

    const payloadHash = computeNwcRequestPayloadHash(
      input.walletId,
      input.invoice,
      paymentHash
    )
    const normalized = { ...input, requestId, paymentHash }

    const cached = this.getCached(requestId)
    if (cached) {
      this.deps.metrics.nwcPaymentDuplicates++
      return Promise.resolve(
        cached.payloadHash === payloadHash
          ? cached.response
          : conflictResponse(requestId)
      )
    }

    const active = this.inFlight.get(requestId)
    if (active) {
      this.deps.metrics.nwcPaymentDuplicates++
      return active.payloadHash === payloadHash
        ? active.promise
        : Promise.resolve(conflictResponse(requestId))
    }

    // Calling run() reaches its first await, then the map is installed before
    // another request callback can run. Every same-process duplicate joins.
    const promise = this.run(normalized, payloadHash)
    this.inFlight.set(requestId, { payloadHash, promise })
    const cleanup = () => {
      if (this.inFlight.get(requestId)?.promise === promise) {
        this.inFlight.delete(requestId)
      }
    }
    void promise.then(cleanup, cleanup)
    return promise
  }

  async status(requestId: string): Promise<NwcPaymentResponse> {
    const normalizedId = requestId.toLowerCase()
    const active = this.inFlight.get(normalizedId)
    const cached = this.getCached(normalizedId)
    if (cached) return cached.response

    const stored = await getNwcRequest(this.deps.pool, normalizedId)
    if (!stored) {
      if (active) {
        return {
          ok: false,
          status: 'pending',
          requestId: normalizedId
        }
      }
      return {
        ok: false,
        status: 'unknown',
        requestId: normalizedId,
        error: {
          code: 'request_not_found',
          message: 'Payment request was not found'
        }
      }
    }

    // A payment_sent notification can durably resolve the row while the SDK
    // request promise is still waiting for (or has lost) its direct reply.
    // Consult Postgres even for an in-flight operation so GET recovery exposes
    // that success immediately.
    if (active && stored.state === 'pending') {
      this.startLookupRecovery(stored, false)
      return { ok: false, status: 'pending', requestId: normalizedId }
    }

    if (stored.state === 'pending' || stored.state === 'unknown') {
      // Read-only recovery only. This never invokes pay_invoice and therefore
      // cannot duplicate an ambiguous dispatch. A later GET observes the
      // lookup result once it has been journaled.
      this.startLookupRecovery(stored, !active)
    }
    const response = responseFromStored(stored)
    this.cacheTerminal(stored.payloadHash, response)
    return response
  }

  private async run(
    input: NwcPaymentRequest,
    payloadHash: string
  ): Promise<NwcPaymentResponse> {
    // The overwhelmingly common warm path claims the durable dispatch
    // boundary in the INSERT, saving one Postgres round-trip before NWC.
    const readyAtRegistration = this.deps.nwcPool.isReady(input.walletId)
    const registration = await registerNwcRequest(
      this.deps.pool,
      {
        requestId: input.requestId,
        walletId: input.walletId,
        invoice: input.invoice,
        paymentHash: input.paymentHash,
        payloadHash
      },
      readyAtRegistration
    )

    if (!registration.created) {
      this.deps.metrics.nwcPaymentDuplicates++
      if (registration.request.payloadHash !== payloadHash) {
        return conflictResponse(input.requestId)
      }
      const storedResponse = responseFromStored(registration.request)
      this.cacheTerminal(payloadHash, storedResponse)
      if (
        registration.request.state === 'pending' ||
        registration.request.state === 'unknown'
      ) {
        // This submit promise is itself in the in-memory registry. Lookup may
        // prove success, but a failed snapshot must not overtake an operation
        // that can still return a valid preimage.
        this.startLookupRecovery(registration.request, false)
      }
      return storedResponse
    }

    const readiness = readyAtRegistration
      ? ({ ready: true } as const)
      : await this.ensureReady(input.walletId)
    if (!readiness.ready) {
      const response: NwcPaymentResponse = {
        ok: false,
        status: 'not_started',
        requestId: input.requestId,
        error: {
          code: readiness.code,
          message: readiness.message
        }
      }
      return this.transition(
        input.requestId,
        payloadHash,
        {
          state: 'not_started',
          errorCode: readiness.code,
          errorMessage: readiness.message
        },
        response
      )
    }

    const dispatchClaimed = readyAtRegistration
      ? true
      : await markNwcRequestDispatched(this.deps.pool, input.requestId)
    if (!dispatchClaimed) {
      const current = await getNwcRequest(this.deps.pool, input.requestId)
      return current
        ? responseFromStored(current)
        : unknownResponse(
            input.requestId,
            'Payment journal changed before dispatch'
          )
    }
    this.deps.metrics.nwcPayments++
    this.deps.metrics.nwcPaymentsPending++

    try {
      const raw = await this.deps.nwcPool.payInvoiceByWalletId(
        input.walletId,
        input.invoice
      )
      const parsed = parsePaymentResult(raw)
      if (
        !parsed.preimage ||
        !verifyPaymentPreimage(parsed.preimage, input.paymentHash)
      ) {
        const message = parsed.preimage
          ? 'Wallet returned a preimage that does not match the payment hash'
          : 'Wallet returned no payment preimage'
        return this.transition(
          input.requestId,
          payloadHash,
          {
            state: 'unknown',
            errorCode: 'relay_error',
            errorMessage: message
          },
          unknownResponse(input.requestId, message)
        )
      }

      const response: NwcPaymentResponse = {
        ok: true,
        status: 'succeeded',
        requestId: input.requestId,
        preimage: parsed.preimage.toLowerCase(),
        feesPaidMsats: parsed.feesPaidMsats
      }
      return this.transition(
        input.requestId,
        payloadHash,
        {
          state: 'succeeded',
          preimage: response.preimage,
          feesPaidMsats: response.feesPaidMsats
        },
        response
      )
    } catch (err) {
      return this.handleDispatchError(input, payloadHash, err)
    } finally {
      this.deps.metrics.nwcPaymentsPending = Math.max(
        0,
        this.deps.metrics.nwcPaymentsPending - 1
      )
    }
  }

  private async handleDispatchError(
    input: NwcPaymentRequest,
    payloadHash: string,
    err: unknown
  ): Promise<NwcPaymentResponse> {
    if (err instanceof NwcPoolError && err.code === 'wallet_error') {
      const response: NwcPaymentResponse = {
        ok: false,
        status: 'rejected',
        requestId: input.requestId,
        error: {
          code: 'wallet_error',
          message: err.message,
          ...(err.walletErrorCode
            ? { walletErrorCode: err.walletErrorCode }
            : {})
        }
      }
      return this.transition(
        input.requestId,
        payloadHash,
        {
          state: 'rejected',
          errorCode: 'wallet_error',
          errorMessage: err.message,
          walletErrorCode: err.walletErrorCode
        },
        response
      )
    }

    // requireReady throws before client.payInvoice is invoked, so this is the
    // only post-registration failure that remains safe for direct fallback.
    if (
      err instanceof NwcPoolError &&
      (err.code === 'wallet_not_found' || err.code === 'wallet_not_connected')
    ) {
      const code =
        err.code === 'wallet_not_found'
          ? ('wallet_not_found' as const)
          : ('wallet_not_ready' as const)
      const response: NwcPaymentResponse = {
        ok: false,
        status: 'not_started',
        requestId: input.requestId,
        error: { code, message: err.message }
      }
      return this.transition(
        input.requestId,
        payloadHash,
        {
          state: 'not_started',
          errorCode: code,
          errorMessage: err.message
        },
        response
      )
    }

    const message =
      err instanceof Error ? err.message : 'Unknown NWC payment transport error'
    this.deps.log.warn(
      { err, requestId: input.requestId, walletId: input.walletId },
      'nwc_payment.unknown_outcome'
    )
    return this.transition(
      input.requestId,
      payloadHash,
      {
        state: 'unknown',
        errorCode: 'relay_error',
        errorMessage: message
      },
      unknownResponse(input.requestId, message)
    )
  }

  /**
   * Applies a monotonic journal transition. A payment_sent notification may
   * win the race while the SDK call is resolving; in that case return the
   * stored success instead of overwriting it with a later error.
   */
  private async transition(
    requestId: string,
    payloadHash: string,
    completion: NwcRequestCompletion,
    intended: NwcPaymentResponse
  ): Promise<NwcPaymentResponse> {
    const updated = await completeNwcRequest(
      this.deps.pool,
      requestId,
      completion
    )
    let response = intended
    if (!updated) {
      const current = await getNwcRequest(this.deps.pool, requestId)
      if (current) response = responseFromStored(current)
    }
    this.cacheTerminal(payloadHash, response)
    return response
  }

  private async ensureReady(walletId: string): Promise<
    | { ready: true }
    | {
        ready: false
        code: 'wallet_not_found' | 'wallet_not_ready'
        message: string
      }
  > {
    if (this.deps.nwcPool.isReady(walletId)) return { ready: true }

    if (!this.deps.nwcPool.hasWallet(walletId)) {
      const found = this.deps.refreshWallet
        ? await this.deps.refreshWallet(walletId)
        : false
      if (!found) {
        return {
          ready: false,
          code: 'wallet_not_found',
          message: 'No active NWC wallet exists for this walletId'
        }
      }
    } else {
      this.deps.nwcPool.prioritizeWallet(walletId)
    }

    const ready = await this.deps.nwcPool.waitUntilReady(
      walletId,
      this.deps.readyGraceMs ?? DEFAULT_READY_GRACE_MS
    )
    return ready
      ? { ready: true }
      : {
          ready: false,
          code: 'wallet_not_ready',
          message: 'Wallet did not become ready before dispatch'
        }
  }

  private startLookupRecovery(
    stored: StoredNwcRequest,
    allowTerminalFailure: boolean
  ): void {
    if (!this.deps.nwcPool.isReady(stored.walletId)) return
    if (this.lookupFlights.has(stored.requestId)) return

    const lookup = this.reconcileWithLookup(stored, allowTerminalFailure)
    this.lookupFlights.set(stored.requestId, lookup)
    const cleanup = () => this.lookupFlights.delete(stored.requestId)
    void lookup.then(cleanup, cleanup)
  }

  private async reconcileWithLookup(
    stored: StoredNwcRequest,
    allowTerminalFailure: boolean
  ): Promise<void> {
    try {
      const raw = await this.deps.nwcPool.lookupInvoiceByWalletId(
        stored.walletId,
        stored.paymentHash
      )
      const parsed = parsePaymentResult(raw)
      if (parsed.state === 'failed') {
        // A lookup can race an SDK pay that is still in progress. It may prove
        // success with a preimage, but a transient/stale failed snapshot must
        // not make a later cryptographic success impossible to journal.
        if (!allowTerminalFailure) return
        await this.transition(
          stored.requestId,
          stored.payloadHash,
          {
            state: 'rejected',
            errorCode: 'wallet_error',
            errorMessage: 'Wallet lookup reports payment failed'
          },
          {
            ok: false,
            status: 'rejected',
            requestId: stored.requestId,
            error: {
              code: 'wallet_error',
              message: 'Wallet lookup reports payment failed'
            }
          }
        )
        return
      }
      if (
        !parsed.preimage ||
        !verifyPaymentPreimage(parsed.preimage, stored.paymentHash)
      ) {
        return
      }
      await this.transition(
        stored.requestId,
        stored.payloadHash,
        {
          state: 'succeeded',
          preimage: parsed.preimage.toLowerCase(),
          feesPaidMsats: parsed.feesPaidMsats
        },
        {
          ok: true,
          status: 'succeeded',
          requestId: stored.requestId,
          preimage: parsed.preimage.toLowerCase(),
          feesPaidMsats: parsed.feesPaidMsats
        }
      )
    } catch (err) {
      // Lookup is recovery only. A timeout/error does not change the durable
      // ambiguous state and, critically, never triggers another payment.
      this.deps.log.debug(
        { err, requestId: stored.requestId },
        'nwc_payment.lookup_inconclusive'
      )
    }
  }

  private cacheTerminal(
    payloadHash: string,
    response: NwcPaymentResponse
  ): void {
    if (
      !response.ok &&
      (response.status === 'pending' || response.status === 'unknown')
    ) {
      return
    }
    this.terminalCache.set(response.requestId, {
      payloadHash,
      response,
      expiresAt:
        Date.now() + (this.deps.terminalCacheMs ?? DEFAULT_TERMINAL_CACHE_MS)
    })
    this.scheduleTerminalCacheSweep()
  }

  private getCached(requestId: string): CachedTerminal | null {
    const cached = this.terminalCache.get(requestId)
    if (!cached) return null
    if (cached.expiresAt <= Date.now()) {
      this.terminalCache.delete(requestId)
      return null
    }
    return cached
  }

  /** One unref'ed timer bounds cache memory without creating a timer per row. */
  private scheduleTerminalCacheSweep(): void {
    if (this.terminalCacheSweep || this.terminalCache.size === 0) return
    let nextExpiry = Number.POSITIVE_INFINITY
    for (const cached of this.terminalCache.values()) {
      nextExpiry = Math.min(nextExpiry, cached.expiresAt)
    }
    this.terminalCacheSweep = setTimeout(
      () => {
        this.terminalCacheSweep = null
        const now = Date.now()
        for (const [requestId, cached] of this.terminalCache) {
          if (cached.expiresAt <= now) this.terminalCache.delete(requestId)
        }
        this.scheduleTerminalCacheSweep()
      },
      Math.max(0, nextExpiry - Date.now())
    )
    this.terminalCacheSweep.unref()
  }
}

export function computeNwcPaymentRequestId(
  walletId: string,
  paymentHash: string
): string {
  return createHash('sha256')
    .update(`${walletId}|${paymentHash.toLowerCase()}`)
    .digest('hex')
}

export function verifyPaymentPreimage(
  preimage: string,
  paymentHash: string
): boolean {
  if (
    !/^[0-9a-f]{64}$/i.test(preimage) ||
    !/^[0-9a-f]{64}$/i.test(paymentHash)
  ) {
    return false
  }
  const actual = createHash('sha256')
    .update(Buffer.from(preimage, 'hex'))
    .digest()
  const expected = Buffer.from(paymentHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function paymentHashFromInvoice(invoice: string): string | null {
  try {
    const decoded = decode(invoice)
    const section = decoded.sections.find(
      candidate => candidate.name === 'payment_hash'
    )
    const value = section && 'value' in section ? section.value : null
    return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
      ? value.toLowerCase()
      : null
  } catch {
    return null
  }
}

function safeHexEqual(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

function parsePaymentResult(raw: unknown): {
  preimage: string | null
  feesPaidMsats: number
  state: string | null
} {
  if (typeof raw !== 'object' || raw === null) {
    return { preimage: null, feesPaidMsats: 0, state: null }
  }
  const result = raw as {
    preimage?: unknown
    fees_paid?: unknown
    state?: unknown
  }
  return {
    preimage: typeof result.preimage === 'string' ? result.preimage : null,
    feesPaidMsats:
      typeof result.fees_paid === 'number' &&
      Number.isSafeInteger(result.fees_paid) &&
      result.fees_paid >= 0
        ? result.fees_paid
        : 0,
    state: typeof result.state === 'string' ? result.state : null
  }
}

function responseFromStored(stored: StoredNwcRequest): NwcPaymentResponse {
  if (
    stored.state === 'succeeded' &&
    stored.preimage &&
    verifyPaymentPreimage(stored.preimage, stored.paymentHash)
  ) {
    return {
      ok: true,
      status: 'succeeded',
      requestId: stored.requestId,
      preimage: stored.preimage.toLowerCase(),
      feesPaidMsats: stored.feesPaidMsats ?? 0
    }
  }

  const status =
    stored.state === 'succeeded'
      ? 'unknown'
      : stored.state === 'pending'
        ? 'pending'
        : stored.state
  return {
    ok: false,
    status,
    requestId: stored.requestId,
    ...(stored.errorMessage
      ? {
          error: {
            code: normalizeErrorCode(stored.errorCode),
            message: stored.errorMessage,
            ...(stored.walletErrorCode
              ? { walletErrorCode: stored.walletErrorCode }
              : {})
          }
        }
      : {})
  }
}

function normalizeErrorCode(
  code: string | null
):
  | 'validation_error'
  | 'request_conflict'
  | 'request_not_found'
  | 'wallet_not_found'
  | 'wallet_not_ready'
  | 'wallet_error'
  | 'relay_error' {
  switch (code) {
    case 'validation_error':
    case 'request_conflict':
    case 'request_not_found':
    case 'wallet_not_found':
    case 'wallet_not_ready':
    case 'wallet_error':
    case 'relay_error':
      return code
    default:
      return 'relay_error'
  }
}

function conflictResponse(requestId: string): NwcPaymentResponse {
  return {
    ok: false,
    status: 'rejected',
    requestId,
    error: {
      code: 'request_conflict',
      message: 'requestId is already bound to a different payment payload'
    }
  }
}

function unknownResponse(
  requestId: string,
  message: string
): NwcPaymentResponse {
  return {
    ok: false,
    status: 'unknown',
    requestId,
    error: { code: 'relay_error', message }
  }
}
