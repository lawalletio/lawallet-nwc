import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

import {
  captureForwardingReceipt,
  loadOwnedRemoteWallet,
  putReceiveAction
} from '@/lib/remote-wallet-forwarding/service'

const enabledAt = new Date('2026-08-01T12:00:00.000Z')
const event = {
  eventKey: 'journal:event:1',
  walletId: 'wallet-1',
  receivedAt: enabledAt.getTime() + 1_000,
  payment: {
    paymentHash: 'AA'.repeat(32),
    amountMsats: 100_000,
    settledAt: Math.floor((enabledAt.getTime() + 1_000) / 1_000)
  }
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    id: 'action-1',
    enabled: true,
    enabledAt,
    remoteWallet: { userId: 'user-1', status: 'ACTIVE' },
    currentRevision: {
      id: 'revision-1',
      revision: 1,
      feeBps: 50,
      baseFeeMsats: BigInt(1_000),
      destinations: [
        { address: 'alice@example.com', allocationBps: 6_000, position: 0 },
        { address: 'bob@example.com', allocationBps: 4_000, position: 1 }
      ]
    },
    ...overrides
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.mocked(prismaMock.remoteWalletReceiveAction.findUnique).mockResolvedValue(
    action() as never
  )
  vi.mocked(prismaMock.remoteWalletForwardReceipt.create).mockResolvedValue({
    id: 'receipt-1'
  } as never)
  // Residual legs parked on already-completed receipts still count as pending.
  vi.mocked(prismaMock.remoteWalletForwardLeg.findMany).mockResolvedValue([])
})

describe('captureForwardingReceipt', () => {
  it('journals amounts and exact multi-destination allocations before returning', async () => {
    await expect(captureForwardingReceipt(event)).resolves.toBe('receipt-1')

    expect(prismaMock.remoteWalletForwardReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventKey: event.eventKey,
        sourcePaymentHash: event.payment.paymentHash.toLowerCase(),
        grossAmountMsats: BigInt(100_000),
        retainedFeeMsats: BigInt(1_500),
        targetAmountMsats: BigInt(98_500),
        routingReserveMsats: BigInt(0),
        status: 'RECEIVED',
        legs: {
          create: [
            expect.objectContaining({
              requestedAmountMsats: BigInt(59_100),
              routingReserveMsats: BigInt(0)
            }),
            expect.objectContaining({
              requestedAmountMsats: BigInt(39_400),
              routingReserveMsats: BigInt(0)
            })
          ]
        }
      })
    })
  })

  it('does not capture while paused', async () => {
    vi.mocked(
      prismaMock.remoteWalletReceiveAction.findUnique
    ).mockResolvedValue(action({ enabled: false }) as never)

    await expect(captureForwardingReceipt(event)).resolves.toBeNull()
    expect(prismaMock.remoteWalletForwardReceipt.create).not.toHaveBeenCalled()
  })

  it('does not capture events settled before the latest activation', async () => {
    await expect(
      captureForwardingReceipt({
        ...event,
        payment: {
          ...event.payment,
          settledAt: Math.floor((enabledAt.getTime() - 1_000) / 1_000)
        }
      })
    ).resolves.toBeNull()
  })

  it('keeps an auditable blocked receipt when the amount is absent', async () => {
    await captureForwardingReceipt({
      ...event,
      payment: { paymentHash: event.payment.paymentHash }
    })

    expect(prismaMock.remoteWalletForwardReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        grossAmountMsats: BigInt(0),
        status: 'BLOCKED',
        legs: undefined,
        lastError: expect.stringContaining('amount was not reported')
      })
    })
  })

  it('keeps a small payment pending so future receipts can accumulate', async () => {
    await captureForwardingReceipt({
      ...event,
      payment: { ...event.payment, amountMsats: 2_000 }
    })

    expect(prismaMock.remoteWalletForwardReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'RECEIVED',
        targetAmountMsats: BigInt(990),
        routingReserveMsats: BigInt(0),
        lastError: null,
        legs: {
          create: [
            expect.objectContaining({
              destination: 'alice@example.com',
              requestedAmountMsats: BigInt(594)
            }),
            expect.objectContaining({
              destination: 'bob@example.com',
              requestedAmountMsats: BigInt(396)
            })
          ]
        }
      })
    })
  })

  it('treats a duplicate wallet/payment hash as an idempotent replay', async () => {
    vi.mocked(prismaMock.remoteWalletForwardReceipt.create).mockRejectedValue({
      code: 'P2002'
    })

    await expect(captureForwardingReceipt(event)).resolves.toBeNull()
  })
})

describe('loadOwnedRemoteWallet', () => {
  it('returns 404 semantics for a wallet owned by another user', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'wallet-1',
      userId: 'someone-else'
    } as never)

    await expect(
      loadOwnedRemoteWallet('wallet-1', 'user-1')
    ).rejects.toMatchObject({
      statusCode: 404
    })
  })
})

describe('putReceiveAction', () => {
  const wallet = {
    id: 'wallet-1',
    userId: 'user-1',
    name: 'Proxy',
    type: 'NWC',
    status: 'ACTIVE',
    config: { mode: 'SEND_RECEIVE' }
  }
  const input = {
    feeBps: 50,
    baseFeeSats: 1,
    destinations: [{ address: 'alice@example.com', allocationBps: 10_000 }]
  }

  beforeEach(() => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      wallet as never
    )
  })

  it('atomically revises an enabled action without resetting activation', async () => {
    vi.mocked(
      prismaMock.remoteWalletReceiveAction.findUnique
    ).mockResolvedValue({
      id: 'action-1',
      enabled: true,
      enabledAt,
      currentRevision: {
        id: 'revision-1',
        revision: 1,
        feeBps: 50,
        baseFeeMsats: BigInt(1_000),
        destinations: [
          {
            address: 'alice@example.com',
            allocationBps: 10_000,
            position: 0
          }
        ]
      }
    } as never)
    vi.mocked(
      prismaMock.remoteWalletReceiveActionRevision.aggregate
    ).mockResolvedValue({ _max: { revision: 1 } } as never)
    vi.mocked(
      prismaMock.remoteWalletReceiveActionRevision.create
    ).mockResolvedValue({ id: 'revision-2' } as never)
    vi.mocked(prismaMock.remoteWalletForwardReceipt.findMany).mockResolvedValue(
      []
    )

    await expect(
      putReceiveAction('wallet-1', 'user-1', input)
    ).resolves.toMatchObject({
      enabled: true
    })
    expect(prismaMock.remoteWalletReceiveAction.update).toHaveBeenCalledWith({
      where: { id: 'action-1' },
      data: expect.objectContaining({
        currentRevisionId: 'revision-2',
        enabled: true,
        enabledAt,
        pausedAt: null
      })
    })
  })

  it('rejects revision while any payment outcome is pending or unknown', async () => {
    vi.mocked(
      prismaMock.remoteWalletReceiveAction.findUnique
    ).mockResolvedValue({
      id: 'action-1',
      enabled: false
    } as never)
    vi.mocked(prismaMock.remoteWalletForwardAttempt.count).mockResolvedValue(1)

    await expect(
      putReceiveAction('wallet-1', 'user-1', input)
    ).rejects.toMatchObject({
      statusCode: 409
    })
  })

  it('rejects destination allocations that are not exactly 100 percent', async () => {
    await expect(
      putReceiveAction('wallet-1', 'user-1', {
        ...input,
        destinations: [{ address: 'alice@example.com', allocationBps: 9_999 }]
      })
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
  })
})
