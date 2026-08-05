import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

const afterMock = vi.hoisted(() =>
  vi.fn((callback: () => void | Promise<void>) => {
    void callback()
  })
)
const loadOwnedRemoteWalletMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: 'wallet-1' })
)
const reconcileMock = vi.hoisted(() => vi.fn())

vi.mock('next/server', async importActual => ({
  ...(await importActual<typeof import('next/server')>()),
  after: afterMock
}))
vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn().mockResolvedValue({ pubkey: 'a'.repeat(64) })
}))
vi.mock('@/lib/auth/account', () => ({
  resolveAccountId: vi.fn().mockResolvedValue('user-1'),
  requireUserId: vi.fn().mockResolvedValue('user-1')
}))
vi.mock('@/lib/remote-wallets/owned', () => ({
  loadOwnedRemoteWallet: loadOwnedRemoteWalletMock
}))
vi.mock('@/lib/remote-wallet-forwarding/service', () => ({
  emitForwardingUpdated: vi.fn()
}))
vi.mock('@/lib/remote-wallet-forwarding/reconcile', () => ({
  reconcileRemoteWalletForwarding: reconcileMock
}))
vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (handler: unknown) => handler
}))

import { GET as LIST } from '@/app/api/remote-wallets/[id]/forwarding-receipts/route'
import { GET as DETAIL } from '@/app/api/remote-wallets/[id]/forwarding-receipts/[receiptId]/route'
import { POST as RETRY } from '@/app/api/remote-wallets/[id]/forwarding-receipts/[receiptId]/retry/route'

const walletId = 'wallet-1'
const receiptId = 'receipt-1'

function receiptRow(overrides: Record<string, unknown> = {}) {
  return {
    id: receiptId,
    walletId,
    userId: 'user-1',
    eventKey: 'event-1',
    sourcePaymentHash: 'aa'.repeat(32),
    sourceInvoice: null,
    grossAmountMsats: BigInt(100_000),
    retainedFeeMsats: BigInt(1_500),
    targetAmountMsats: BigInt(98_500),
    forwardedAmountMsats: BigInt(0),
    routingFeeMsats: BigInt(0),
    routingReserveMsats: BigInt(0),
    unusedRoutingReserveMsats: BigInt(0),
    routingFeeOverageMsats: BigInt(0),
    shortfallMsats: BigInt(0),
    configRevision: 1,
    status: 'BLOCKED',
    recovered: false,
    sourceSettledAt: new Date('2026-08-03T12:00:00.000Z'),
    lastError: null,
    nextRetryAt: new Date('2026-08-03T12:00:00.000Z'),
    completedAt: null,
    createdAt: new Date('2026-08-03T12:00:00.000Z'),
    updatedAt: new Date('2026-08-03T12:00:00.000Z'),
    legs: [],
    ...overrides
  }
}

beforeEach(() => {
  resetPrismaMock()
  afterMock.mockClear()
  reconcileMock.mockClear()
  loadOwnedRemoteWalletMock.mockResolvedValue({ id: walletId })
})

describe('GET /api/remote-wallets/[id]/forwarding-receipts', () => {
  it('returns a cursor page scoped to the owned wallet', async () => {
    vi.mocked(prismaMock.remoteWalletForwardReceipt.findMany).mockResolvedValue(
      [receiptRow()] as never
    )

    const response = await LIST(
      createNextRequest(
        `/api/remote-wallets/${walletId}/forwarding-receipts?limit=20`
      ),
      createParamsPromise({ id: walletId })
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.receipts).toHaveLength(1)
    expect(body.nextCursor).toBeNull()
    expect(loadOwnedRemoteWalletMock).toHaveBeenCalledWith(walletId, 'user-1')
  })

  it('reports a wallet owned by somebody else as missing', async () => {
    const { NotFoundError } = await import('@/types/server/errors')
    loadOwnedRemoteWalletMock.mockRejectedValue(
      new NotFoundError('Wallet not found')
    )

    const response = await LIST(
      createNextRequest(`/api/remote-wallets/${walletId}/forwarding-receipts`),
      createParamsPromise({ id: walletId })
    )

    expect(response.status).toBe(404)
  })
})

describe('GET /api/remote-wallets/[id]/forwarding-receipts/[receiptId]', () => {
  it('404s for a receipt that belongs to another wallet', async () => {
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.findFirst
    ).mockResolvedValue(null)

    const response = await DETAIL(
      createNextRequest(
        `/api/remote-wallets/${walletId}/forwarding-receipts/${receiptId}`
      ),
      createParamsPromise({ id: walletId, receiptId })
    )

    expect(response.status).toBe(404)
  })
})

describe('POST /api/remote-wallets/[id]/forwarding-receipts/[receiptId]/retry', () => {
  it('conflicts when no leg actually needed a retry', async () => {
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.findFirst
    ).mockResolvedValue(
      receiptRow({ action: { enabled: true } }) as never
    )
    // Nothing rejected/expired, and nothing scheduled in the future: a leg that
    // is already READY and due is not a retry.
    vi.mocked(prismaMock.remoteWalletForwardLeg.updateMany).mockResolvedValue({
      count: 0
    })

    const response = await RETRY(
      createNextRequest(
        `/api/remote-wallets/${walletId}/forwarding-receipts/${receiptId}/retry`,
        { method: 'POST', body: {} }
      ),
      createParamsPromise({ id: walletId, receiptId })
    )

    expect(response.status).toBe(409)
    expect(afterMock).not.toHaveBeenCalled()
  })

  it('refuses to retry while forwarding is paused', async () => {
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.findFirst
    ).mockResolvedValue(
      receiptRow({ action: { enabled: false } }) as never
    )

    const response = await RETRY(
      createNextRequest(
        `/api/remote-wallets/${walletId}/forwarding-receipts/${receiptId}/retry`,
        { method: 'POST', body: {} }
      ),
      createParamsPromise({ id: walletId, receiptId })
    )

    expect(response.status).toBe(409)
    expect(prismaMock.remoteWalletForwardLeg.updateMany).not.toHaveBeenCalled()
  })

  it('reschedules rejected legs and wakes the reconciler', async () => {
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.findFirst
    ).mockResolvedValue(
      receiptRow({ action: { enabled: true } }) as never
    )
    vi.mocked(prismaMock.remoteWalletForwardLeg.updateMany)
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 0 })

    const response = await RETRY(
      createNextRequest(
        `/api/remote-wallets/${walletId}/forwarding-receipts/${receiptId}/retry`,
        { method: 'POST', body: {} }
      ),
      createParamsPromise({ id: walletId, receiptId })
    )

    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({
      accepted: true,
      retryingLegs: 2
    })
    expect(reconcileMock).toHaveBeenCalledWith({ ids: [receiptId] })
  })
})
