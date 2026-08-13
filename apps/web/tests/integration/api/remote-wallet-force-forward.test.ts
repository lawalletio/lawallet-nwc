import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

const afterMock = vi.hoisted(() =>
  vi.fn((callback: () => void | Promise<void>) => {
    void callback()
  })
)
const loadOwnedRemoteWalletMock = vi.hoisted(() => vi.fn())
const emitForwardingUpdatedMock = vi.hoisted(() => vi.fn())
const reconcileRemoteWalletForwardingMock = vi.hoisted(() => vi.fn())
const sweepMissedPaymentsMock = vi.hoisted(() => vi.fn())

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
  emitForwardingUpdated: emitForwardingUpdatedMock
}))
vi.mock('@/lib/remote-wallet-forwarding/reconcile', () => ({
  reconcileRemoteWalletForwarding: reconcileRemoteWalletForwardingMock
}))
vi.mock('@/lib/remote-wallet-forwarding/capture-sweep', () => ({
  sweepMissedPayments: sweepMissedPaymentsMock
}))
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  })),
  withRequestLogging: (handler: unknown) => handler
}))
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
  RateLimitPresets: { sensitive: {} }
}))
vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

import { POST } from '@/app/api/remote-wallets/[id]/receive-action/force/route'

const walletId = '9ade2025-e923-4128-8335-b1db582d4020'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  loadOwnedRemoteWalletMock.mockResolvedValue({ id: walletId })
  sweepMissedPaymentsMock.mockResolvedValue(0)
  reconcileRemoteWalletForwardingMock.mockResolvedValue({
    claimed: 0,
    completed: 0,
    failed: 0
  })
  vi.mocked(prismaMock.remoteWalletReceiveAction.findUnique).mockResolvedValue({
    id: 'action-1',
    enabled: true,
    currentRevisionId: 'revision-1'
  } as never)
  vi.mocked(prismaMock.remoteWalletForwardReceipt.updateMany).mockResolvedValue(
    { count: 4 }
  )
})

describe('POST /api/remote-wallets/[id]/receive-action/force', () => {
  it('advances all open receipts and wakes the wallet-scoped worker', async () => {
    const response = await POST(
      createNextRequest(
        `/api/remote-wallets/${walletId}/receive-action/force`,
        { method: 'POST' }
      ),
      createParamsPromise({ id: walletId })
    )

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      forwardingReceipts: 4
    })
    expect(
      prismaMock.remoteWalletForwardReceipt.updateMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          actionId: 'action-1',
          walletId,
          userId: 'user-1'
        })
      })
    )
    expect(emitForwardingUpdatedMock).toHaveBeenCalledOnce()
    expect(afterMock).toHaveBeenCalledOnce()
    expect(reconcileRemoteWalletForwardingMock).toHaveBeenCalledWith({
      walletIds: [walletId]
    })
  })

  it('refuses to force forwarding while the action is paused', async () => {
    vi.mocked(
      prismaMock.remoteWalletReceiveAction.findUnique
    ).mockResolvedValue({
      id: 'action-1',
      enabled: false,
      currentRevisionId: 'revision-1'
    } as never)

    const response = await POST(
      createNextRequest(
        `/api/remote-wallets/${walletId}/receive-action/force`,
        { method: 'POST' }
      ),
      createParamsPromise({ id: walletId })
    )

    expect(response.status).toBe(409)
    expect(
      prismaMock.remoteWalletForwardReceipt.updateMany
    ).not.toHaveBeenCalled()
    expect(reconcileRemoteWalletForwardingMock).not.toHaveBeenCalled()
  })

  it('reports a state conflict when there is nothing pending', async () => {
    vi.mocked(
      prismaMock.remoteWalletForwardReceipt.updateMany
    ).mockResolvedValue({ count: 0 })

    const response = await POST(
      createNextRequest(
        `/api/remote-wallets/${walletId}/receive-action/force`,
        { method: 'POST' }
      ),
      createParamsPromise({ id: walletId })
    )

    // 409, matching /proxy-balance for the same condition — it is a state
    // conflict, not malformed input.
    expect(response.status).toBe(409)
    expect(afterMock).not.toHaveBeenCalled()
  })

  it('recovers payments the listener never delivered before deciding there is nothing to do', async () => {
    // The whole point of the button on a stuck wallet: no receipt exists yet
    // because the payment_received webhook was lost, so capture has to run
    // first or this answers "nothing pending" while the funds sit there.
    sweepMissedPaymentsMock.mockImplementation(async () => {
      vi.mocked(
        prismaMock.remoteWalletForwardReceipt.updateMany
      ).mockResolvedValue({ count: 1 })
      return 1
    })
    vi.mocked(prismaMock.remoteWalletForwardReceipt.updateMany).mockResolvedValue(
      { count: 0 }
    )

    const response = await POST(
      createNextRequest(
        `/api/remote-wallets/${walletId}/receive-action/force`,
        { method: 'POST' }
      ),
      createParamsPromise({ id: walletId })
    )

    expect(sweepMissedPaymentsMock).toHaveBeenCalledWith({
      walletIds: [walletId],
      force: true
    })
    expect(response.status).toBe(202)
  })

  it('still forwards known receipts when the wallet cannot be swept', async () => {
    sweepMissedPaymentsMock.mockRejectedValue(new Error('relay down'))

    const response = await POST(
      createNextRequest(
        `/api/remote-wallets/${walletId}/receive-action/force`,
        { method: 'POST' }
      ),
      createParamsPromise({ id: walletId })
    )

    expect(response.status).toBe(202)
  })
})
