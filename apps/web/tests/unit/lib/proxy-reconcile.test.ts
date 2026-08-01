import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('node:crypto', async importActual => ({
  ...(await importActual<typeof import('node:crypto')>()),
  randomUUID: () => 'worker-from-claim'
}))

const {
  getProxySettlementConfig,
  getListenerConfig,
  getListenerNwcPayment,
  listenerNwcPayment,
  listenerNwcRequest,
  fetchDestinationMetadata,
  requestDestinationInvoice,
  emitEvent
} = vi.hoisted(() => ({
  getProxySettlementConfig: vi.fn(),
  getListenerConfig: vi.fn(),
  getListenerNwcPayment: vi.fn(),
  listenerNwcPayment: vi.fn(),
  listenerNwcRequest: vi.fn(),
  fetchDestinationMetadata: vi.fn(),
  requestDestinationInvoice: vi.fn(),
  emitEvent: vi.fn()
}))

vi.mock('@/lib/proxy/config', () => ({ getProxySettlementConfig }))
vi.mock('@/lib/listener-config', () => ({ getListenerConfig }))
vi.mock('@/lib/wallet/drivers/listener-transport', () => ({
  getListenerNwcPayment,
  listenerNwcPayment,
  listenerNwcRequest
}))
vi.mock('@/lib/proxy/lnurl', () => ({
  fetchDestinationMetadata,
  requestDestinationInvoice
}))
vi.mock('@/lib/proxy/nostr', () => ({
  publishZapReceipt: vi.fn()
}))
vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: emitEvent }
}))
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

import { reconcileProxyPayments } from '@/lib/proxy/reconcile'

const preimage = '01'.repeat(32)
const destinationHash = createHash('sha256')
  .update(Buffer.from(preimage, 'hex'))
  .digest('hex')

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    invoiceId: 'invoice-1',
    username: 'alice',
    destination: 'bob@destination.example',
    blockedHosts: ['lawallet.example'],
    destinationMetadata: {},
    feeBps: 50,
    grossAmountMsats: BigInt(100_000),
    serviceFeeMsats: BigInt(500),
    destinationAmountMsats: BigInt(99_500),
    forwardedAmountMsats: null,
    routingFeeMsats: null,
    comment: null,
    zapRequest: null,
    zapRequestJson: null,
    status: 'FORWARDING',
    sourcePaidAt: new Date(),
    sourcePreimage: null,
    forwardedAt: null,
    receiptEventId: null,
    receiptPublishedAt: null,
    retryCount: 0,
    nextRetryAt: new Date(),
    lastError: null,
    leaseOwner: 'worker-from-claim',
    leaseExpiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    invoice: {
      id: 'invoice-1',
      bolt11: 'lnbc1payer',
      paymentHash: 'f'.repeat(64),
      status: 'PAID',
      preimage: null,
      paidAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000)
    },
    attempts: [],
    ...overrides
  }
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    proxyPaymentId: 'payment-1',
    attemptNo: 1,
    bolt11: 'lnbc1destination',
    paymentHash: destinationHash,
    amountMsats: BigInt(99_500),
    expiresAt: new Date(Date.now() + 60_000),
    requestId: 'e'.repeat(64),
    status: 'PENDING',
    preimage: null,
    routingFeeMsats: null,
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null,
    ...overrides
  }
}

describe('proxy reconciler', () => {
  beforeEach(() => {
    resetPrismaMock()
    vi.clearAllMocks()
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([{ id: 'payment-1' }])
    vi.mocked(prismaMock.proxyInvoiceIntent.deleteMany).mockResolvedValue({
      count: 0
    })
    vi.mocked(prismaMock.proxyServiceConfig.updateMany).mockResolvedValue({
      count: 1
    })
    vi.mocked(prismaMock.proxyPayment.updateMany).mockResolvedValue({
      count: 1
    })
    vi.mocked(prismaMock.proxyForwardAttempt.updateMany).mockResolvedValue({
      count: 1
    })
    getProxySettlementConfig.mockResolvedValue({
      row: { walletId: '__lawallet_proxy__' },
      connectionString: 'nwc',
      receiptPrivateKey: null
    })
    getListenerConfig.mockResolvedValue({
      enabled: true,
      url: 'http://listener',
      secret: 'secret'
    })
    fetchDestinationMetadata.mockResolvedValue({
      tag: 'payRequest',
      callback: 'https://destination.example/cb',
      minSendable: 1_000,
      maxSendable: 1_000_000,
      metadata: '[]'
    })
    requestDestinationInvoice.mockResolvedValue({
      bolt11: 'lnbc1destination',
      paymentHash: destinationHash,
      amountMsats: 99_500,
      expiresAt: new Date(Date.now() + 60_000)
    })
    vi.mocked(prismaMock.proxyForwardAttempt.create).mockResolvedValue(
      attempt() as never
    )
  })

  it('does not call the destination callback before inbound settlement', async () => {
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment({
        status: 'BLOCKED',
        sourcePaidAt: null,
        invoice: {
          ...payment().invoice,
          status: 'PENDING',
          paidAt: null
        }
      }) as never
    )
    listenerNwcRequest.mockResolvedValue({ state: 'pending' })

    const result = await reconcileProxyPayments({
      workerId: 'worker-from-claim'
    })

    expect(result.completed).toBe(0)
    expect(requestDestinationInvoice).not.toHaveBeenCalled()
    expect(listenerNwcPayment).not.toHaveBeenCalled()
  })

  it('checks NWC before expiring a source invoice whose webhook was missed', async () => {
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment({
        status: 'PENDING_INBOUND',
        sourcePaidAt: null,
        invoice: {
          ...payment().invoice,
          status: 'PENDING',
          paidAt: null,
          expiresAt: new Date(Date.now() - 1_000)
        }
      }) as never
    )
    listenerNwcRequest.mockResolvedValue({
      state: 'settled',
      amount: 100_000
    })
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      requestId: 'e'.repeat(64),
      preimage,
      feesPaidMsats: 0
    })

    await reconcileProxyPayments({ workerId: 'worker-from-claim' })

    expect(listenerNwcRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: 'lookup_invoice',
        params: { payment_hash: 'f'.repeat(64) }
      })
    )
    expect(requestDestinationInvoice).toHaveBeenCalledOnce()
  })

  it('requests and pays the destination invoice only after source settlement', async () => {
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment() as never
    )
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      requestId: 'e'.repeat(64),
      preimage,
      feesPaidMsats: 123
    })

    const result = await reconcileProxyPayments({
      workerId: 'worker-from-claim'
    })

    expect(result.completed).toBe(1)
    expect(requestDestinationInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        amountMsats: 99_500,
        blockedHosts: ['lawallet.example']
      })
    )
    expect(listenerNwcPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        walletId: '__lawallet_proxy__',
        paymentHash: destinationHash,
        idempotencyScope: 'payment-1',
        attemptNo: 1,
        requestId: createHash('sha256')
          .update(`__lawallet_proxy__|${destinationHash}|payment-1|1`)
          .digest('hex')
      })
    )
    expect(prismaMock.proxyPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          forwardedAmountMsats: BigInt(99_500),
          routingFeeMsats: BigInt(123),
          status: 'COMPLETED'
        })
      })
    )
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'invoices:updated' })
    )
    // Claim, durable in-flight attempt, and completed outcome each broadcast.
    expect(emitEvent).toHaveBeenCalledTimes(3)
  })

  it('completes a destination invoice that rounds down by exactly 10 sats', async () => {
    const roundedDownMsats = 89_500
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment() as never
    )
    requestDestinationInvoice.mockResolvedValue({
      bolt11: 'lnbc1roundeddown',
      paymentHash: destinationHash,
      amountMsats: roundedDownMsats,
      expiresAt: new Date(Date.now() + 60_000)
    })
    vi.mocked(prismaMock.proxyForwardAttempt.create).mockResolvedValue(
      attempt({
        bolt11: 'lnbc1roundeddown',
        amountMsats: BigInt(roundedDownMsats)
      }) as never
    )
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      requestId: 'e'.repeat(64),
      preimage,
      feesPaidMsats: 25
    })

    const result = await reconcileProxyPayments({
      workerId: 'worker-from-claim'
    })

    expect(result.completed).toBe(1)
    expect(prismaMock.proxyForwardAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountMsats: BigInt(roundedDownMsats)
      })
    })
    expect(prismaMock.proxyPayment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          forwardedAmountMsats: BigInt(roundedDownMsats)
        })
      })
    )
  })

  it('lets only one simultaneous worker claim and create the destination invoice', async () => {
    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>).mockImplementation(
      async (...args: unknown[]) =>
        args.includes('worker-from-claim') ? [{ id: 'payment-1' }] : []
    )
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment() as never
    )
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      requestId: 'e'.repeat(64),
      preimage,
      feesPaidMsats: 0
    })

    const [first, second] = await Promise.all([
      reconcileProxyPayments({ workerId: 'worker-from-claim' }),
      reconcileProxyPayments({ workerId: 'other-worker' })
    ])

    expect(first.claimed + second.claimed).toBe(1)
    expect(requestDestinationInvoice).toHaveBeenCalledTimes(1)
    expect(listenerNwcPayment).toHaveBeenCalledTimes(1)
  })

  it('keeps an unknown unexpired payment in FORWARDING without another invoice', async () => {
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment({ attempts: [attempt()] }) as never
    )
    getListenerNwcPayment.mockResolvedValue({
      ok: false,
      status: 'unknown',
      requestId: 'e'.repeat(64),
      error: { code: 'outcome_unknown', message: 'still unknown' }
    })

    await reconcileProxyPayments({ workerId: 'worker-from-claim' })

    expect(requestDestinationInvoice).not.toHaveBeenCalled()
    expect(prismaMock.proxyForwardAttempt.create).not.toHaveBeenCalled()
  })

  it('looks up an expired unknown payment before requesting a fresh invoice', async () => {
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment({
        attempts: [
          attempt({
            status: 'UNKNOWN',
            expiresAt: new Date(Date.now() - 1_000)
          })
        ]
      }) as never
    )
    getListenerNwcPayment.mockResolvedValue({
      ok: false,
      status: 'unknown',
      requestId: 'e'.repeat(64),
      error: { code: 'outcome_unknown', message: 'still unknown' }
    })
    listenerNwcRequest.mockResolvedValue({ state: 'failed' })
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      requestId: 'c'.repeat(64),
      preimage,
      feesPaidMsats: 0
    })

    await reconcileProxyPayments({ workerId: 'worker-from-claim' })

    expect(listenerNwcRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: 'lookup_invoice',
        params: { payment_hash: destinationHash }
      })
    )
    expect(requestDestinationInvoice).toHaveBeenCalledOnce()
  })

  it('reuses an unexpired rejected invoice instead of requesting a new one', async () => {
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment({
        attempts: [attempt({ status: 'REJECTED' })]
      }) as never
    )
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      requestId: 'd'.repeat(64),
      preimage,
      feesPaidMsats: 0
    })

    await reconcileProxyPayments({ workerId: 'worker-from-claim' })

    expect(requestDestinationInvoice).not.toHaveBeenCalled()
    expect(prismaMock.proxyForwardAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attemptNo: 2,
        bolt11: 'lnbc1destination',
        paymentHash: destinationHash,
        requestId: createHash('sha256')
          .update(`__lawallet_proxy__|${destinationHash}|payment-1|2`)
          .digest('hex')
      })
    })
  })

  it('never reuses the previous invoice after the owner changes destination', async () => {
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment({
        destination: 'carol@new-destination.example',
        attempts: [
          attempt({
            status: 'REJECTED',
            errorCode: 'destination_changed',
            errorMessage: 'Superseded by carol@new-destination.example'
          })
        ]
      }) as never
    )
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      requestId: 'd'.repeat(64),
      preimage,
      feesPaidMsats: 0
    })

    await reconcileProxyPayments({ workerId: 'worker-from-claim' })

    expect(fetchDestinationMetadata).toHaveBeenCalledWith(
      'carol@new-destination.example',
      { blockedHosts: ['lawallet.example'] }
    )
    expect(requestDestinationInvoice).toHaveBeenCalledOnce()
    expect(prismaMock.proxyForwardAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ attemptNo: 2 })
    })
  })

  it('requests a fresh destination invoice only after the prior one expires', async () => {
    vi.mocked(prismaMock.proxyPayment.findUnique).mockResolvedValue(
      payment({
        attempts: [
          attempt({
            status: 'REJECTED',
            expiresAt: new Date(Date.now() - 1_000)
          })
        ]
      }) as never
    )
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      requestId: 'c'.repeat(64),
      preimage,
      feesPaidMsats: 0
    })

    await reconcileProxyPayments({ workerId: 'worker-from-claim' })

    expect(requestDestinationInvoice).toHaveBeenCalledOnce()
  })
})
