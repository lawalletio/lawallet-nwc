import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

const afterMock = vi.hoisted(() =>
  vi.fn((callback: () => void | Promise<void>) => {
    void callback()
  })
)
const putReceiveActionMock = vi.hoisted(() => vi.fn())
const setReceiveActionEnabledMock = vi.hoisted(() => vi.fn())
const reconcileRemoteWalletForwardingMock = vi.hoisted(() => vi.fn())

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
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/remote-wallet-forwarding/service', () => ({
  getReceiveActionDto: vi.fn(),
  putReceiveAction: putReceiveActionMock,
  setReceiveActionEnabled: setReceiveActionEnabledMock
}))
vi.mock('@/lib/remote-wallet-forwarding/reconcile', () => ({
  reconcileRemoteWalletForwarding: reconcileRemoteWalletForwardingMock
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
vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

import { PATCH, PUT } from '@/app/api/remote-wallets/[id]/receive-action/route'

const walletId = '9ade2025-e923-4128-8335-b1db582d4020'
const action = {
  id: 'action-1',
  remoteWalletId: walletId,
  enabled: true
}

beforeEach(() => {
  vi.clearAllMocks()
  putReceiveActionMock.mockResolvedValue(action)
  setReceiveActionEnabledMock.mockResolvedValue(action)
  reconcileRemoteWalletForwardingMock.mockResolvedValue({
    claimed: 0,
    completed: 0,
    failed: 0
  })
})

describe('RemoteWallet receive-action wake-up', () => {
  it('wakes the wallet-scoped reconciler immediately after resume', async () => {
    const response = await PATCH(
      createNextRequest(`/api/remote-wallets/${walletId}/receive-action`, {
        method: 'PATCH',
        body: { enabled: true }
      }),
      createParamsPromise({ id: walletId })
    )

    expect(response.status).toBe(200)
    expect(afterMock).toHaveBeenCalledOnce()
    expect(reconcileRemoteWalletForwardingMock).toHaveBeenCalledWith({
      walletIds: [walletId]
    })
  })

  it('does not run forwarding while pausing', async () => {
    setReceiveActionEnabledMock.mockResolvedValue({
      ...action,
      enabled: false
    })

    const response = await PATCH(
      createNextRequest(`/api/remote-wallets/${walletId}/receive-action`, {
        method: 'PATCH',
        body: { enabled: false }
      }),
      createParamsPromise({ id: walletId })
    )

    expect(response.status).toBe(200)
    expect(afterMock).not.toHaveBeenCalled()
    expect(reconcileRemoteWalletForwardingMock).not.toHaveBeenCalled()
  })

  it('wakes pending receipts after editing an enabled plan', async () => {
    const response = await PUT(
      createNextRequest(`/api/remote-wallets/${walletId}/receive-action`, {
        method: 'PUT',
        body: {
          feeBps: 0,
          baseFeeSats: 0,
          destinations: [
            { address: 'agustin@primal.net', allocationBps: 10_000 }
          ]
        }
      }),
      createParamsPromise({ id: walletId })
    )

    expect(response.status).toBe(200)
    expect(reconcileRemoteWalletForwardingMock).toHaveBeenCalledWith({
      walletIds: [walletId]
    })
  })
})
