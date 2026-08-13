import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn().mockResolvedValue({ pubkey: 'a'.repeat(64) })
}))
vi.mock('@/lib/auth/account', () => ({
  resolveAccountId: vi.fn().mockResolvedValue('user-1'),
  requireUserId: vi.fn().mockResolvedValue('user-1')
}))
vi.mock('@/lib/remote-wallets/owned', () => ({
  loadOwnedRemoteWallet: vi.fn().mockResolvedValue({ id: 'wallet-1' }),
  loadViewableRemoteWallet: vi.fn().mockResolvedValue({
    wallet: { id: 'wallet-1', userId: 'user-1' },
    isOwner: true,
    userId: 'user-1'
  })
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

import { GET } from '@/app/api/remote-wallets/[id]/forwarding-activity/route'

beforeEach(() => {
  resetPrismaMock()
})

describe('GET /api/remote-wallets/[id]/forwarding-activity', () => {
  it('returns an owner-scoped cursor page of attempts', async () => {
    vi.mocked(prismaMock.remoteWalletForwardAttempt.findMany).mockResolvedValue(
      [
        {
          id: 'attempt-2',
          attemptNo: 2,
          amountMsats: BigInt(98_000),
          status: 'REJECTED',
          errorMessage: 'Route unavailable',
          createdAt: new Date('2026-08-03T12:00:00.000Z'),
          leg: {
            id: 'leg-1',
            receiptId: 'receipt-1',
            destination: 'alice@example.com'
          }
        },
        {
          id: 'attempt-1',
          attemptNo: 1,
          amountMsats: BigInt(98_000),
          status: 'SUCCEEDED',
          errorMessage: null,
          createdAt: new Date('2026-08-03T11:00:00.000Z'),
          leg: {
            id: 'leg-1',
            receiptId: 'receipt-1',
            destination: 'alice@example.com'
          }
        }
      ] as never
    )

    const response = await GET(
      createNextRequest(
        '/api/remote-wallets/wallet-1/forwarding-activity?limit=1&cursor=attempt-0'
      ),
      createParamsPromise({ id: 'wallet-1' })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      activity: [
        {
          id: 'attempt-2',
          receiptId: 'receipt-1',
          legId: 'leg-1',
          destination: 'alice@example.com',
          attemptNo: 2,
          amountMsats: 98_000,
          status: 'REJECTED',
          errorMessage: 'Route unavailable',
          createdAt: '2026-08-03T12:00:00.000Z'
        }
      ],
      nextCursor: 'attempt-2'
    })
    expect(prismaMock.remoteWalletForwardAttempt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leg: { receipt: { walletId: 'wallet-1' } } },
        take: 2,
        cursor: { id: 'attempt-0' },
        skip: 1
      })
    )
  })
})
