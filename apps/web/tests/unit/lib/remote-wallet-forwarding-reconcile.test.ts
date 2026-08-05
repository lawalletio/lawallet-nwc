import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const {
  getListenerConfig,
  getListenerNwcPayment,
  listenerNwcPayment,
  listenerNwcRequest,
  fetchDestinationMetadata,
  requestDestinationInvoice
} = vi.hoisted(() => ({
  getListenerConfig: vi.fn(),
  getListenerNwcPayment: vi.fn(),
  listenerNwcPayment: vi.fn(),
  listenerNwcRequest: vi.fn(),
  fetchDestinationMetadata: vi.fn(),
  requestDestinationInvoice: vi.fn()
}))

vi.mock('@/lib/listener-config', () => ({ getListenerConfig }))
vi.mock('@/lib/wallet/drivers/listener-transport', async importActual => ({
  ...(await importActual<
    typeof import('@/lib/wallet/drivers/listener-transport')
  >()),
  getListenerNwcPayment,
  listenerNwcPayment,
  listenerNwcRequest
}))
vi.mock('@/lib/proxy/lnurl', () => ({
  fetchDestinationMetadata,
  requestDestinationInvoice
}))
vi.mock('@/lib/public-url', () => ({
  resolvePublicEndpoint: vi.fn(async () => ({
    host: 'wallet.example',
    url: 'https://wallet.example'
  })),
  resolveApiUrl: vi.fn(async () => 'https://wallet.example')
}))
vi.mock('@/lib/wallet/remote-wallet-vault', () => ({
  decryptRemoteWalletConfig: vi.fn(() => ({
    connectionString: 'nostr+walletconnect://test'
  }))
}))
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { reconcileRemoteWalletForwarding } from '@/lib/remote-wallet-forwarding/reconcile'
import { ListenerPaymentAmbiguousError } from '@/lib/wallet/drivers/listener-transport'

const preimage = '33'.repeat(32)
const destinationHash = createHash('sha256')
  .update(Buffer.from(preimage, 'hex'))
  .digest('hex')

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    legId: 'leg-1',
    attemptNo: 1,
    bolt11: 'lnbc1destination',
    paymentHash: destinationHash,
    amountMsats: BigInt(96_500),
    requestId: 'request-1',
    status: 'UNKNOWN',
    preimage: null,
    routingFeeMsats: null,
    routingReserveMsats: BigInt(2_000),
    errorCode: null,
    errorMessage: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null,
    ...overrides
  }
}

function leg(overrides: Record<string, unknown> = {}) {
  return {
    id: 'leg-1',
    receiptId: 'receipt-1',
    position: 0,
    destination: 'alice@destination.example',
    allocationBps: 10_000,
    requestedAmountMsats: BigInt(98_500),
    forwardedAmountMsats: null,
    routingFeeMsats: null,
    routingReserveMsats: BigInt(2_000),
    unusedRoutingReserveMsats: BigInt(0),
    routingFeeOverageMsats: BigInt(0),
    destinationShortfallMsats: BigInt(0),
    status: 'READY',
    retryCount: 0,
    nextRetryAt: new Date(),
    lastError: null,
    supersededAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    batchAnchorId: null,
    attempts: [],
    ...overrides
  }
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'receipt-1',
    actionId: 'action-1',
    revisionId: 'revision-1',
    walletId: 'wallet-1',
    userId: 'user-1',
    eventKey: 'event-1',
    sourcePaymentHash: 'aa'.repeat(32),
    sourceInvoice: null,
    grossAmountMsats: BigInt(100_000),
    retainedFeeMsats: BigInt(1_500),
    targetAmountMsats: BigInt(98_500),
    forwardedAmountMsats: BigInt(0),
    routingFeeMsats: BigInt(0),
    routingReserveMsats: BigInt(2_000),
    unusedRoutingReserveMsats: BigInt(0),
    routingFeeOverageMsats: BigInt(0),
    shortfallMsats: BigInt(0),
    configRevision: 1,
    status: 'FORWARDING',
    recovered: false,
    sourceSettledAt: new Date(),
    lastError: null,
    nextRetryAt: new Date(),
    leaseOwner: 'worker-1',
    leaseExpiresAt: new Date(Date.now() + 60_000),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    action: { id: 'action-1', enabled: true },
    revision: {
      feeBps: 50,
      baseFeeMsats: BigInt(1_000),
      destinations: [
        {
          address: 'alice@destination.example',
          allocationBps: 10_000,
          position: 0
        }
      ]
    },
    wallet: { id: 'wallet-1', type: 'NWC', status: 'ACTIVE', config: {} },
    legs: [leg()],
    ...overrides
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.$queryRaw).mockResolvedValue([{ id: 'receipt-1' }])
  vi.mocked(prismaMock.remoteWalletForwardReceipt.findUnique).mockResolvedValue(
    receipt() as never
  )
  vi.mocked(prismaMock.remoteWalletForwardReceipt.findMany).mockResolvedValue(
    []
  )
  vi.mocked(prismaMock.remoteWalletReceiveAction.findFirst).mockResolvedValue({
    id: 'action-1'
  } as never)
  vi.mocked(prismaMock.remoteWalletForwardLeg.findFirst).mockResolvedValue({
    id: 'leg-1'
  } as never)
  vi.mocked(prismaMock.remoteWalletForwardAttempt.create).mockResolvedValue(
    attempt({ status: 'PENDING' }) as never
  )
  vi.mocked(prismaMock.remoteWalletForwardReceipt.updateMany).mockResolvedValue(
    {
      count: 1
    }
  )
  vi.mocked(prismaMock.remoteWalletForwardAttempt.updateMany).mockResolvedValue(
    {
      count: 1
    }
  )
  vi.mocked(prismaMock.remoteWalletForwardLeg.updateMany).mockResolvedValue({
    count: 1
  })
  vi.mocked(prismaMock.remoteWalletForwardLeg.findMany).mockImplementation(
    args => {
      const where = args?.where as
        | { receiptId?: string; destination?: string; batchAnchorId?: string }
        | undefined
      if (where?.receiptId) {
        return Promise.resolve([
          leg({
            status: 'SUCCEEDED',
            forwardedAmountMsats: BigInt(98_500),
            routingFeeMsats: BigInt(25),
            routingReserveMsats: BigInt(2_000),
            unusedRoutingReserveMsats: BigInt(1_975)
          })
        ]) as never
      }
      return Promise.resolve([leg()]) as never
    }
  )
  getListenerConfig.mockResolvedValue({ enabled: true, url: 'http://listener' })
  fetchDestinationMetadata.mockResolvedValue({
    callback: 'https://destination.example/cb',
    minSendable: 1,
    maxSendable: 1_000_000,
    metadata: '[]',
    tag: 'payRequest'
  })
  requestDestinationInvoice.mockResolvedValue({
    bolt11: 'lnbc1destination',
    paymentHash: destinationHash,
    amountMsats: 96_500,
    expiresAt: new Date(Date.now() + 60_000)
  })
})

describe('remote wallet forwarding reconciler', () => {
  it('keeps the full pending amount ready when it is still too small to send', async () => {
    const first = leg({ requestedAmountMsats: BigInt(1_000) })
    const second = leg({
      id: 'leg-2',
      receiptId: 'receipt-2',
      requestedAmountMsats: BigInt(1_000)
    })
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.findUnique
    ).mockResolvedValue(
      receipt({
        targetAmountMsats: BigInt(1_000),
        routingReserveMsats: BigInt(0),
        status: 'RECEIVED',
        legs: [first]
      }) as never
    )
    vi.mocked(prismaMock.remoteWalletForwardLeg.findMany).mockImplementation(
      args => {
        const where = args?.where as
          | { receiptId?: string; destination?: string }
          | undefined
        if (where?.receiptId) return Promise.resolve([first]) as never
        if (where?.destination) return Promise.resolve([first, second]) as never
        return Promise.resolve([]) as never
      }
    )

    const result = await reconcileRemoteWalletForwarding({
      workerId: 'worker-1'
    })

    expect(result).toEqual({ claimed: 1, completed: 0, failed: 0 })
    expect(requestDestinationInvoice).not.toHaveBeenCalled()
    expect(prismaMock.remoteWalletForwardAttempt.create).not.toHaveBeenCalled()
    expect(prismaMock.remoteWalletForwardLeg.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['leg-1', 'leg-2'] } }),
        data: expect.objectContaining({
          status: 'READY',
          batchAnchorId: null
        })
      })
    )
    expect(
      prismaMock.remoteWalletForwardReceipt.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'BLOCKED',
          lastError:
            'Pending amount is too small to forward. It will be retried when more funds arrive.'
        })
      })
    )
  })

  it('attempts the complete accumulated amount and distributes its reserve safely', async () => {
    const first = leg({ requestedAmountMsats: BigInt(1_000) })
    const second = leg({
      id: 'leg-2',
      receiptId: 'receipt-2',
      requestedAmountMsats: BigInt(2_000)
    })
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.findUnique
    ).mockResolvedValue(
      receipt({
        targetAmountMsats: BigInt(1_000),
        routingReserveMsats: BigInt(0),
        status: 'RECEIVED',
        legs: [first]
      }) as never
    )
    vi.mocked(prismaMock.remoteWalletForwardAttempt.create).mockResolvedValue(
      attempt({
        status: 'PENDING',
        amountMsats: BigInt(1_000),
        routingReserveMsats: BigInt(2_000)
      }) as never
    )
    vi.mocked(prismaMock.remoteWalletForwardLeg.findMany).mockImplementation(
      args => {
        const where = args?.where as
          | { receiptId?: string; destination?: string; batchAnchorId?: string }
          | undefined
        if (where?.receiptId) {
          const source = where.receiptId === 'receipt-2' ? second : first
          return Promise.resolve([
            {
              ...source,
              status: 'SUCCEEDED',
              forwardedAmountMsats: source.requestedAmountMsats,
              routingFeeMsats: BigInt(0)
            }
          ]) as never
        }
        if (where?.destination || where?.batchAnchorId)
          return Promise.resolve([first, second]) as never
        return Promise.resolve([]) as never
      }
    )
    requestDestinationInvoice.mockResolvedValue({
      bolt11: 'lnbc1accumulated',
      paymentHash: destinationHash,
      amountMsats: 1_000,
      expiresAt: new Date(Date.now() + 60_000)
    })
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      preimage,
      feesPaidMsats: 0
    })

    await reconcileRemoteWalletForwarding({ workerId: 'worker-1' })

    expect(requestDestinationInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amountMsats: 1_000 })
    )
    expect(prismaMock.remoteWalletForwardAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          legId: 'leg-1',
          amountMsats: BigInt(1_000),
          routingReserveMsats: BigInt(2_000)
        })
      })
    )
    expect(prismaMock.remoteWalletForwardLeg.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['leg-1', 'leg-2'] } },
        data: expect.objectContaining({
          batchAnchorId: 'leg-1',
          status: 'PENDING'
        })
      })
    )
    expect(prismaMock.remoteWalletForwardLeg.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'leg-1',
        batchAnchorId: 'leg-1',
        status: 'PENDING'
      },
      data: {
        routingReserveMsats: BigInt(667),
        nextRetryAt: expect.any(Date)
      }
    })
    expect(prismaMock.remoteWalletForwardLeg.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'leg-2',
        batchAnchorId: 'leg-1',
        status: 'PENDING'
      },
      data: {
        routingReserveMsats: BigInt(1_333),
        nextRetryAt: expect.any(Date)
      }
    })
  })

  it('adds new receipts to a safely rejected pending batch before retrying', async () => {
    const current = leg({
      id: 'leg-new',
      requestedAmountMsats: BigInt(2_000)
    })
    const previous = leg({
      id: 'leg-old',
      receiptId: 'receipt-old',
      requestedAmountMsats: BigInt(3_000),
      status: 'REJECTED',
      batchAnchorId: 'leg-old'
    })
    const rejected = attempt({
      id: 'attempt-old',
      legId: 'leg-old',
      status: 'REJECTED',
      amountMsats: BigInt(1_000),
      routingReserveMsats: BigInt(2_000),
      errorCode: 'temporary_failure',
      resolvedAt: new Date()
    })
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.findUnique
    ).mockResolvedValue(
      receipt({
        targetAmountMsats: BigInt(2_000),
        routingReserveMsats: BigInt(0),
        status: 'RECEIVED',
        legs: [current]
      }) as never
    )
    vi.mocked(prismaMock.remoteWalletForwardLeg.findFirst).mockResolvedValue({
      batchAnchorId: 'leg-old'
    } as never)
    vi.mocked(
      prismaMock.remoteWalletForwardAttempt.findFirst
    ).mockResolvedValue(rejected as never)
    vi.mocked(prismaMock.remoteWalletForwardAttempt.create).mockResolvedValue(
      attempt({
        id: 'attempt-new',
        legId: 'leg-old',
        attemptNo: 2,
        status: 'PENDING',
        amountMsats: BigInt(3_000),
        routingReserveMsats: BigInt(2_000)
      }) as never
    )
    vi.mocked(prismaMock.remoteWalletForwardLeg.findMany).mockImplementation(
      args => {
        const where = args?.where as
          | {
              receiptId?: string
              destination?: string
              batchAnchorId?: string | null
            }
          | undefined
        if (where?.receiptId) {
          const source = where.receiptId === 'receipt-old' ? previous : current
          return Promise.resolve([
            {
              ...source,
              status: 'SUCCEEDED',
              forwardedAmountMsats: source.requestedAmountMsats,
              routingFeeMsats: BigInt(0)
            }
          ]) as never
        }
        if (where?.batchAnchorId === null)
          return Promise.resolve([current]) as never
        if (where?.destination || where?.batchAnchorId === 'leg-old')
          return Promise.resolve([previous, current]) as never
        return Promise.resolve([]) as never
      }
    )
    requestDestinationInvoice.mockResolvedValue({
      bolt11: 'lnbc1grown',
      paymentHash: destinationHash,
      amountMsats: 3_000,
      expiresAt: new Date(Date.now() + 60_000)
    })
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      preimage,
      feesPaidMsats: 0
    })

    await reconcileRemoteWalletForwarding({ workerId: 'worker-1' })

    expect(requestDestinationInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amountMsats: 3_000 })
    )
    expect(prismaMock.remoteWalletForwardAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          legId: 'leg-old',
          attemptNo: 2,
          amountMsats: BigInt(3_000)
        })
      })
    )
  })

  it('persists an attempt before paying and completes a claimed receipt', async () => {
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      preimage,
      feesPaidMsats: 25
    })

    const result = await reconcileRemoteWalletForwarding({
      workerId: 'worker-1'
    })

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 })
    expect(prismaMock.remoteWalletForwardAttempt.create).toHaveBeenCalledOnce()
    expect(requestDestinationInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amountMsats: 96_500 })
    )
    expect(prismaMock.remoteWalletForwardLeg.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          routingReserveMsats: BigInt(2_000),
          routingFeeMsats: BigInt(25),
          unusedRoutingReserveMsats: BigInt(1_975),
          routingFeeOverageMsats: BigInt(0)
        })
      })
    )
    expect(
      vi.mocked(prismaMock.remoteWalletForwardAttempt.create).mock
        .invocationCallOrder[0]
    ).toBeLessThan(listenerNwcPayment.mock.invocationCallOrder[0])
  })

  it('joins an ambiguous journal request without creating or publishing a new attempt', async () => {
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.findUnique
    ).mockResolvedValue(
      receipt({
        legs: [leg({ status: 'UNKNOWN', attempts: [attempt()] })]
      }) as never
    )
    getListenerNwcPayment.mockResolvedValue(null)
    listenerNwcPayment.mockRejectedValue(
      new ListenerPaymentAmbiguousError('outcome unknown')
    )
    vi.mocked(prismaMock.remoteWalletForwardLeg.findMany).mockResolvedValue([
      leg({ status: 'UNKNOWN', lastError: 'outcome unknown' })
    ] as never)

    const result = await reconcileRemoteWalletForwarding({
      workerId: 'worker-1'
    })

    expect(result.failed).toBe(0)
    expect(prismaMock.remoteWalletForwardAttempt.create).not.toHaveBeenCalled()
    expect(listenerNwcPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requestId: 'request-1', attemptNo: 1 })
    )
    expect(requestDestinationInvoice).not.toHaveBeenCalled()
  })

  it('requests a smaller fresh invoice after terminal insufficient balance', async () => {
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.findUnique
    ).mockResolvedValue(
      receipt({
        legs: [
          leg({
            status: 'REJECTED',
            attempts: [
              attempt({
                status: 'REJECTED',
                amountMsats: BigInt(98_500),
                routingReserveMsats: BigInt(0),
                errorCode: 'INSUFFICIENT_BALANCE',
                resolvedAt: new Date()
              })
            ]
          })
        ]
      }) as never
    )
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      preimage,
      feesPaidMsats: 25
    })

    await reconcileRemoteWalletForwarding({ workerId: 'worker-1' })

    expect(requestDestinationInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amountMsats: 96_500 })
    )
    expect(prismaMock.remoteWalletForwardAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptNo: 2,
          routingReserveMsats: BigInt(2_000)
        })
      })
    )
  })

  it('recognizes legacy insufficient-balance attempts that stored only wallet_error', async () => {
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.findUnique
    ).mockResolvedValue(
      receipt({
        legs: [
          leg({
            status: 'REJECTED',
            attempts: [
              attempt({
                status: 'REJECTED',
                amountMsats: BigInt(98_500),
                routingReserveMsats: BigInt(0),
                errorCode: 'wallet_error',
                errorMessage:
                  'Insufficient balance remaining to make the requested payment',
                resolvedAt: new Date()
              })
            ]
          })
        ]
      }) as never
    )
    getListenerNwcPayment.mockResolvedValue(null)
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      preimage,
      feesPaidMsats: 25
    })

    await reconcileRemoteWalletForwarding({ workerId: 'worker-1' })

    expect(requestDestinationInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amountMsats: 96_500 })
    )
  })

  it('doubles the prior reserve after another terminal insufficient balance', async () => {
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.findUnique
    ).mockResolvedValue(
      receipt({
        legs: [
          leg({
            status: 'REJECTED',
            attempts: [
              attempt({
                status: 'REJECTED',
                routingReserveMsats: BigInt(2_000),
                errorCode: 'INSUFFICIENT_BALANCE',
                resolvedAt: new Date()
              })
            ]
          })
        ]
      }) as never
    )
    requestDestinationInvoice.mockResolvedValue({
      bolt11: 'lnbc1destination2',
      paymentHash: destinationHash,
      amountMsats: 94_500,
      expiresAt: new Date(Date.now() + 60_000)
    })
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      preimage,
      feesPaidMsats: 25
    })

    await reconcileRemoteWalletForwarding({ workerId: 'worker-1' })

    expect(requestDestinationInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ amountMsats: 94_500 })
    )
    expect(prismaMock.remoteWalletForwardAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          routingReserveMsats: BigInt(4_000)
        })
      })
    )
  })

  it('persists the raw NWC insufficient-balance code for a safe retry', async () => {
    listenerNwcPayment.mockResolvedValue({
      ok: false,
      status: 'rejected',
      requestId: 'request-1',
      error: {
        code: 'wallet_error',
        walletErrorCode: 'INSUFFICIENT_BALANCE',
        message: 'Insufficient balance remaining'
      }
    })
    vi.mocked(prismaMock.remoteWalletForwardLeg.findMany).mockResolvedValue([
      leg({ status: 'REJECTED', lastError: 'Insufficient balance remaining' })
    ] as never)

    await reconcileRemoteWalletForwarding({ workerId: 'worker-1' })

    expect(
      prismaMock.remoteWalletForwardAttempt.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          errorCode: 'INSUFFICIENT_BALANCE'
        })
      })
    )
  })

  it('does nothing when another worker already owns every claimable receipt', async () => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([])

    await expect(
      reconcileRemoteWalletForwarding({ workerId: 'worker-2' })
    ).resolves.toEqual({ claimed: 0, completed: 0, failed: 0 })
    expect(
      prismaMock.remoteWalletForwardReceipt.findUnique
    ).not.toHaveBeenCalled()
    expect(listenerNwcPayment).not.toHaveBeenCalled()
  })

  it('claims work through a per-wallet action lease', async () => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([])

    await reconcileRemoteWalletForwarding({ workerId: 'worker-2' })

    const template = vi.mocked(prismaMock.$queryRaw).mock.calls[0]?.[0]
    expect(Array.from(template as readonly string[]).join('')).toContain(
      'UPDATE "RemoteWalletReceiveAction" action'
    )
    expect(Array.from(template as readonly string[]).join('')).toContain(
      'action."leaseExpiresAt"'
    )
  })

  it('audits routing fees that exceed the planned reserve', async () => {
    listenerNwcPayment.mockResolvedValue({
      ok: true,
      status: 'succeeded',
      preimage,
      feesPaidMsats: 2_500
    })

    await reconcileRemoteWalletForwarding({ workerId: 'worker-1' })

    expect(prismaMock.remoteWalletForwardLeg.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          routingReserveMsats: BigInt(2_000),
          unusedRoutingReserveMsats: BigInt(0),
          routingFeeOverageMsats: BigInt(500)
        })
      })
    )
  })

  it('does not dispatch a stale leg superseded during destination resolution', async () => {
    vi.mocked(prismaMock.remoteWalletForwardLeg.findMany).mockResolvedValue([])

    await reconcileRemoteWalletForwarding({ workerId: 'worker-1' })

    expect(prismaMock.remoteWalletForwardAttempt.create).not.toHaveBeenCalled()
    expect(listenerNwcPayment).not.toHaveBeenCalled()
  })

  it('turns a legacy small blocked receipt into accumulated pending funds', async () => {
    const pendingLeg = leg({
      requestedAmountMsats: BigInt(2_000),
      routingReserveMsats: BigInt(0)
    })
    const legacy = receipt({
      targetAmountMsats: BigInt(2_000),
      routingReserveMsats: BigInt(0),
      status: 'BLOCKED',
      lastError:
        'Forwarding amount is too small for all configured destinations',
      legs: []
    })
    const pending = receipt({
      targetAmountMsats: BigInt(2_000),
      routingReserveMsats: BigInt(0),
      status: 'RECEIVED',
      lastError: null,
      legs: [pendingLeg]
    })
    vi.mocked(prismaMock.remoteWalletForwardReceipt.findUnique)
      .mockResolvedValueOnce(legacy as never)
      .mockResolvedValueOnce(pending as never)
    vi.mocked(prismaMock.remoteWalletForwardReceipt.findMany).mockResolvedValue(
      [legacy] as never
    )
    vi.mocked(prismaMock.remoteWalletForwardLeg.count).mockResolvedValue(0)
    vi.mocked(prismaMock.remoteWalletForwardLeg.findMany).mockResolvedValue([
      pendingLeg
    ] as never)

    await reconcileRemoteWalletForwarding({ workerId: 'worker-1' })

    expect(prismaMock.remoteWalletForwardLeg.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          receiptId: 'receipt-1',
          requestedAmountMsats: BigInt(2_000)
        })
      ]
    })
    expect(prismaMock.remoteWalletForwardReceipt.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'RECEIVED',
          lastError: null
        })
      })
    )
    expect(requestDestinationInvoice).not.toHaveBeenCalled()
  })

  it('closes a recovered sub-fee source payment as retained without creating legs', async () => {
    const missingAmount = receipt({
      grossAmountMsats: BigInt(0),
      retainedFeeMsats: BigInt(0),
      targetAmountMsats: BigInt(0),
      status: 'BLOCKED',
      legs: []
    })
    const retained = receipt({
      grossAmountMsats: BigInt(1_000),
      retainedFeeMsats: BigInt(1_000),
      targetAmountMsats: BigInt(0),
      status: 'RETAINED',
      legs: []
    })
    vi.mocked(prismaMock.remoteWalletForwardReceipt.findUnique)
      .mockResolvedValueOnce(missingAmount as never)
      .mockResolvedValueOnce(retained as never)
    listenerNwcRequest.mockResolvedValue({ state: 'settled', amount: 1_000 })

    const result = await reconcileRemoteWalletForwarding({
      workerId: 'worker-1'
    })

    expect(result).toEqual({ claimed: 1, completed: 1, failed: 0 })
    expect(prismaMock.remoteWalletForwardLeg.createMany).not.toHaveBeenCalled()
    expect(
      prismaMock.remoteWalletForwardReceipt.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'RETAINED' })
      })
    )
  })
})
