import { createHash } from 'node:crypto'
import pino from 'pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type pg from 'pg'
import type { NwcPaymentRequest } from '@lawallet-nwc/shared'
import { metrics as baseMetrics, type Metrics } from '../src/metrics'
import type { NwcPool } from '../src/nwc/pool'

const decodeMock = vi.hoisted(() => vi.fn())

vi.mock('light-bolt11-decoder', () => ({ decode: decodeMock }))

vi.mock('../src/store', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/store')>()
  return {
    ...actual,
    registerNwcRequest: vi.fn(),
    markNwcRequestDispatched: vi.fn(),
    completeNwcRequest: vi.fn(),
    getNwcRequest: vi.fn()
  }
})

import {
  completeNwcRequest,
  computeNwcRequestPayloadHash,
  getNwcRequest,
  markNwcRequestDispatched,
  registerNwcRequest,
  type StoredNwcRequest
} from '../src/store'
import {
  computeNwcPaymentRequestId,
  NwcPaymentService,
  verifyPaymentPreimage
} from '../src/nwc/payments'
import { NwcPoolError } from '../src/nwc/pool'

const preimage = '11'.repeat(32)
const paymentHash = createHash('sha256')
  .update(Buffer.from(preimage, 'hex'))
  .digest('hex')

const input: NwcPaymentRequest = {
  requestId: computeNwcPaymentRequestId('wallet-1', paymentHash),
  walletId: 'wallet-1',
  invoice: 'lnbc1-valid-invoice',
  paymentHash,
  waitMs: 8000
}

const stored = (
  overrides: Partial<StoredNwcRequest> = {}
): StoredNwcRequest => ({
  requestId: input.requestId,
  walletId: input.walletId,
  invoice: input.invoice,
  paymentHash: input.paymentHash,
  payloadHash: computeNwcRequestPayloadHash(
    input.walletId,
    input.invoice,
    input.paymentHash
  ),
  state: 'pending',
  dispatchedAt: null,
  preimage: null,
  feesPaidMsats: null,
  errorCode: null,
  errorMessage: null,
  walletErrorCode: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  completedAt: null,
  ...overrides
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function freshMetrics(): Metrics {
  return { ...baseMetrics, startedAt: new Date() }
}

function fakeNwcPool() {
  return {
    isReady: vi.fn(() => true),
    hasWallet: vi.fn(() => true),
    prioritizeWallet: vi.fn(),
    waitUntilReady: vi.fn(async () => true),
    payInvoiceByWalletId: vi.fn(),
    lookupInvoiceByWalletId: vi.fn()
  }
}

function makeService(nwcPool = fakeNwcPool()) {
  const metrics = freshMetrics()
  const service = new NwcPaymentService({
    pool: { query: vi.fn() } as unknown as pg.Pool,
    nwcPool: nwcPool as unknown as NwcPool,
    log: pino({ level: 'silent' }),
    metrics,
    refreshWallet: vi.fn(async () => false),
    readyGraceMs: 10
  })
  return { service, nwcPool, metrics }
}

beforeEach(() => {
  vi.clearAllMocks()
  decodeMock.mockReturnValue({
    sections: [{ name: 'payment_hash', value: paymentHash }]
  })
  vi.mocked(markNwcRequestDispatched).mockResolvedValue(true)
  vi.mocked(completeNwcRequest).mockResolvedValue(true)
  vi.mocked(getNwcRequest).mockResolvedValue(null)
})

describe('preimage verification', () => {
  it('accepts only a 32-byte preimage matching the invoice payment hash', () => {
    expect(verifyPaymentPreimage(preimage, paymentHash)).toBe(true)
    expect(verifyPaymentPreimage('22'.repeat(32), paymentHash)).toBe(false)
    expect(verifyPaymentPreimage('not-hex', paymentHash)).toBe(false)
  })
})

describe('NwcPaymentService', () => {
  it('rejects an invoice whose encoded hash does not match before dispatch', async () => {
    const { service, nwcPool } = makeService()
    decodeMock.mockReturnValueOnce({
      sections: [{ name: 'payment_hash', value: 'ff'.repeat(32) }]
    })

    await expect(service.submit(input)).resolves.toMatchObject({
      ok: false,
      status: 'rejected',
      error: { code: 'validation_error' }
    })
    expect(registerNwcRequest).not.toHaveBeenCalled()
    expect(nwcPool.payInvoiceByWalletId).not.toHaveBeenCalled()
  })

  it('single-flights duplicate requests and dispatches pay_invoice once', async () => {
    const payment = deferred<unknown>()
    const { service, nwcPool, metrics } = makeService()
    vi.mocked(registerNwcRequest).mockResolvedValue({
      created: true,
      request: stored()
    })
    nwcPool.payInvoiceByWalletId.mockReturnValue(payment.promise)

    const first = service.submit(input)
    const duplicate = service.submit(input)
    await vi.waitFor(() =>
      expect(nwcPool.payInvoiceByWalletId).toHaveBeenCalledTimes(1)
    )
    payment.resolve({ preimage, fees_paid: 1250 })

    await expect(first).resolves.toEqual({
      ok: true,
      status: 'succeeded',
      requestId: input.requestId,
      preimage,
      feesPaidMsats: 1250
    })
    await expect(duplicate).resolves.toMatchObject({ status: 'succeeded' })
    expect(registerNwcRequest).toHaveBeenCalledTimes(1)
    expect(registerNwcRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestId: input.requestId }),
      true
    )
    // Warm path folds the dispatch boundary into the INSERT.
    expect(markNwcRequestDispatched).not.toHaveBeenCalled()
    expect(completeNwcRequest).toHaveBeenCalledWith(
      expect.anything(),
      input.requestId,
      expect.objectContaining({ state: 'succeeded', preimage })
    )
    expect(metrics.nwcPaymentDuplicates).toBe(1)
    expect(metrics.nwcPaymentsPending).toBe(0)
  })

  it('continues and journals a late result after callers stop waiting', async () => {
    const payment = deferred<unknown>()
    const { service, nwcPool } = makeService()
    vi.mocked(registerNwcRequest).mockResolvedValue({
      created: true,
      request: stored()
    })
    nwcPool.payInvoiceByWalletId.mockReturnValue(payment.promise)

    const operation = service.submit(input)
    await vi.waitFor(() =>
      expect(nwcPool.payInvoiceByWalletId).toHaveBeenCalledTimes(1)
    )
    // The HTTP route may return 202 here; no cancellation reaches this promise.
    payment.resolve({ preimage, fees_paid: 0 })
    await operation

    expect(completeNwcRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      input.requestId,
      expect.objectContaining({ state: 'succeeded' })
    )
  })

  it('physically evicts terminal cache entries after five minutes', async () => {
    vi.useFakeTimers()
    const { service, nwcPool } = makeService()
    vi.mocked(registerNwcRequest).mockResolvedValue({
      created: true,
      request: stored()
    })
    nwcPool.payInvoiceByWalletId.mockResolvedValue({ preimage, fees_paid: 0 })

    await service.submit(input)
    const cache = (
      service as unknown as {
        terminalCache: Map<string, unknown>
      }
    ).terminalCache
    expect(cache.size).toBe(1)

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(cache.size).toBe(0)
    vi.useRealTimers()
  })

  it('reports notification-backed success while the SDK reply is still pending', async () => {
    const payment = deferred<unknown>()
    const { service, nwcPool } = makeService()
    vi.mocked(registerNwcRequest).mockResolvedValue({
      created: true,
      request: stored({ dispatchedAt: new Date() })
    })
    nwcPool.payInvoiceByWalletId.mockReturnValue(payment.promise)

    const operation = service.submit(input)
    await vi.waitFor(() =>
      expect(nwcPool.payInvoiceByWalletId).toHaveBeenCalledTimes(1)
    )
    vi.mocked(getNwcRequest).mockResolvedValue(
      stored({
        state: 'succeeded',
        dispatchedAt: new Date(),
        preimage,
        feesPaidMsats: 10,
        completedAt: new Date()
      })
    )

    await expect(service.status(input.requestId)).resolves.toMatchObject({
      ok: true,
      status: 'succeeded',
      preimage
    })

    payment.resolve({ preimage, fees_paid: 10 })
    await operation
  })

  it('does not let a failed lookup overtake an active payment', async () => {
    const payment = deferred<unknown>()
    const { service, nwcPool } = makeService()
    vi.mocked(registerNwcRequest).mockResolvedValue({
      created: true,
      request: stored({ dispatchedAt: new Date() })
    })
    nwcPool.payInvoiceByWalletId.mockReturnValue(payment.promise)
    nwcPool.lookupInvoiceByWalletId.mockResolvedValue({ state: 'failed' })
    vi.mocked(getNwcRequest).mockResolvedValue(
      stored({ dispatchedAt: new Date() })
    )

    const operation = service.submit(input)
    await vi.waitFor(() =>
      expect(nwcPool.payInvoiceByWalletId).toHaveBeenCalledTimes(1)
    )

    await expect(service.status(input.requestId)).resolves.toMatchObject({
      status: 'pending'
    })
    await vi.waitFor(() =>
      expect(
        (service as unknown as { lookupFlights: Map<string, unknown> })
          .lookupFlights.size
      ).toBe(0)
    )
    expect(completeNwcRequest).not.toHaveBeenCalledWith(
      expect.anything(),
      input.requestId,
      expect.objectContaining({ state: 'rejected' })
    )

    payment.resolve({ preimage, fees_paid: 10 })
    await expect(operation).resolves.toMatchObject({ status: 'succeeded' })
    expect(completeNwcRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      input.requestId,
      expect.objectContaining({ state: 'succeeded', preimage })
    )
  })

  it('marks a mismatched preimage unknown and never reports success', async () => {
    const { service, nwcPool } = makeService()
    vi.mocked(registerNwcRequest).mockResolvedValue({
      created: true,
      request: stored()
    })
    nwcPool.payInvoiceByWalletId.mockResolvedValue({
      preimage: '22'.repeat(32),
      fees_paid: 0
    })

    await expect(service.submit(input)).resolves.toMatchObject({
      ok: false,
      status: 'unknown'
    })
    expect(completeNwcRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      input.requestId,
      expect.objectContaining({ state: 'unknown' })
    )
  })

  it('does not dispatch when a payment notification wins before the dispatch boundary', async () => {
    const { service, nwcPool } = makeService()
    nwcPool.isReady.mockReturnValue(false)
    nwcPool.waitUntilReady.mockResolvedValue(true)
    vi.mocked(registerNwcRequest).mockResolvedValue({
      created: true,
      request: stored()
    })
    vi.mocked(markNwcRequestDispatched).mockResolvedValue(false)
    vi.mocked(getNwcRequest).mockResolvedValue(
      stored({
        state: 'succeeded',
        preimage,
        feesPaidMsats: 0,
        completedAt: new Date()
      })
    )

    await expect(service.submit(input)).resolves.toMatchObject({
      ok: true,
      status: 'succeeded',
      preimage
    })
    expect(nwcPool.payInvoiceByWalletId).not.toHaveBeenCalled()
  })

  it('returns a final rejection for a wallet error', async () => {
    const { service, nwcPool } = makeService()
    vi.mocked(registerNwcRequest).mockResolvedValue({
      created: true,
      request: stored()
    })
    nwcPool.payInvoiceByWalletId.mockRejectedValue(
      new NwcPoolError(
        'wallet_error',
        'not enough sats',
        'INSUFFICIENT_BALANCE'
      )
    )

    await expect(service.submit(input)).resolves.toMatchObject({
      ok: false,
      status: 'rejected',
      error: {
        code: 'wallet_error',
        walletErrorCode: 'INSUFFICIENT_BALANCE'
      }
    })
    expect(completeNwcRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      input.requestId,
      expect.objectContaining({ state: 'rejected' })
    )
  })

  it('returns not_started when a targeted reconcile cannot find the wallet', async () => {
    const nwcPool = fakeNwcPool()
    nwcPool.isReady.mockReturnValue(false)
    nwcPool.hasWallet.mockReturnValue(false)
    const metrics = freshMetrics()
    const refreshWallet = vi.fn(async () => false)
    const service = new NwcPaymentService({
      pool: { query: vi.fn() } as unknown as pg.Pool,
      nwcPool: nwcPool as unknown as NwcPool,
      log: pino({ level: 'silent' }),
      metrics,
      refreshWallet
    })
    vi.mocked(registerNwcRequest).mockResolvedValue({
      created: true,
      request: stored()
    })

    await expect(service.submit(input)).resolves.toMatchObject({
      ok: false,
      status: 'not_started',
      error: { code: 'wallet_not_found' }
    })
    expect(refreshWallet).toHaveBeenCalledWith('wallet-1')
    expect(nwcPool.payInvoiceByWalletId).not.toHaveBeenCalled()
  })

  it('prioritizes an existing wallet that is still warming', async () => {
    const nwcPool = fakeNwcPool()
    nwcPool.isReady.mockReturnValue(false)
    nwcPool.waitUntilReady.mockResolvedValue(false)
    const { service } = makeService(nwcPool)
    vi.mocked(registerNwcRequest).mockResolvedValue({
      created: true,
      request: stored()
    })

    await expect(service.submit(input)).resolves.toMatchObject({
      status: 'not_started'
    })
    expect(nwcPool.prioritizeWallet).toHaveBeenCalledWith('wallet-1')
    expect(nwcPool.payInvoiceByWalletId).not.toHaveBeenCalled()
  })

  it('rejects a request-id payload conflict without dispatching', async () => {
    const changed = { ...input, invoice: 'lnbc1-different' }
    const { service, nwcPool } = makeService()
    vi.mocked(registerNwcRequest).mockResolvedValue({
      created: false,
      request: stored()
    })

    await expect(service.submit(changed)).resolves.toMatchObject({
      ok: false,
      status: 'rejected',
      error: { code: 'request_conflict' }
    })
    expect(nwcPool.payInvoiceByWalletId).not.toHaveBeenCalled()
  })

  it('recovers an unknown request with lookup_invoice and never pays again', async () => {
    const { service, nwcPool } = makeService()
    vi.mocked(getNwcRequest).mockResolvedValue(
      stored({
        state: 'unknown',
        dispatchedAt: new Date(),
        errorCode: 'relay_error',
        errorMessage: 'listener restarted'
      })
    )
    nwcPool.lookupInvoiceByWalletId.mockResolvedValue({
      preimage,
      fees_paid: 500
    })

    await expect(service.status(input.requestId)).resolves.toMatchObject({
      status: 'unknown'
    })
    await vi.waitFor(() =>
      expect(completeNwcRequest).toHaveBeenCalledWith(
        expect.anything(),
        input.requestId,
        expect.objectContaining({ state: 'succeeded', preimage })
      )
    )
    await expect(service.status(input.requestId)).resolves.toMatchObject({
      ok: true,
      status: 'succeeded',
      preimage
    })
    expect(nwcPool.payInvoiceByWalletId).not.toHaveBeenCalled()
  })

  it('marks a definitively failed lookup as rejected without paying again', async () => {
    const { service, nwcPool } = makeService()
    vi.mocked(getNwcRequest).mockResolvedValue(
      stored({
        state: 'unknown',
        dispatchedAt: new Date(),
        errorCode: 'relay_error',
        errorMessage: 'listener restarted'
      })
    )
    nwcPool.lookupInvoiceByWalletId.mockResolvedValue({ state: 'failed' })

    await expect(service.status(input.requestId)).resolves.toMatchObject({
      status: 'unknown'
    })
    await vi.waitFor(() =>
      expect(completeNwcRequest).toHaveBeenCalledWith(
        expect.anything(),
        input.requestId,
        expect.objectContaining({ state: 'rejected' })
      )
    )
    expect(nwcPool.payInvoiceByWalletId).not.toHaveBeenCalled()
  })
})
