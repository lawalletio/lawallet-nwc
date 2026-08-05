import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

const afterMock = vi.hoisted(() =>
  vi.fn((callback: () => void | Promise<void>) => {
    void callback()
  })
)
const rateLimitMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
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
vi.mock('@/lib/remote-wallet-notifications/reconcile', () => ({
  reconcileRemoteWalletNotifications: reconcileMock
}))
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: rateLimitMock,
  RateLimitPresets: { sensitive: {} }
}))
vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (handler: unknown) => handler
}))

import { GET as LIST_NOTIFICATIONS } from '@/app/api/remote-wallets/[id]/notifications/route'
import { POST as RETRY_DELIVERY } from '@/app/api/remote-wallets/[id]/notification-deliveries/[deliveryId]/retry/route'

const walletId = 'wallet-1'
const deliveryId = 'delivery-1'

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    id: deliveryId,
    walletId,
    status: 'REJECTED',
    leaseExpiresAt: null,
    notification: { channel: 'WEBHOOK', enabled: true },
    attempts: [],
    ...overrides
  }
}

beforeEach(() => {
  resetPrismaMock()
  afterMock.mockClear()
  reconcileMock.mockClear()
  rateLimitMock.mockClear()
  vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
    id: walletId,
    userId: 'user-1',
    status: 'ACTIVE'
  } as never)
})

describe('GET /api/remote-wallets/[id]/notifications', () => {
  it('lists notifications for the owned wallet', async () => {
    vi.mocked(prismaMock.remoteWalletNotification.findMany).mockResolvedValue(
      [] as never
    )

    const response = await LIST_NOTIFICATIONS(
      createNextRequest(`/api/remote-wallets/${walletId}/notifications`),
      createParamsPromise({ id: walletId })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ notifications: [] })
  })

  it('reports another owner’s wallet as missing', async () => {
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: walletId,
      userId: 'someone-else'
    } as never)

    const response = await LIST_NOTIFICATIONS(
      createNextRequest(`/api/remote-wallets/${walletId}/notifications`),
      createParamsPromise({ id: walletId })
    )

    expect(response.status).toBe(404)
  })
})

describe('POST /api/remote-wallets/[id]/notification-deliveries/[deliveryId]/retry', () => {
  it('rate limits before dispatching an outbound webhook', async () => {
    vi.mocked(
      prismaMock.remoteWalletNotificationDelivery.findFirst
    ).mockResolvedValue(delivery() as never)

    const response = await RETRY_DELIVERY(
      createNextRequest(
        `/api/remote-wallets/${walletId}/notification-deliveries/${deliveryId}/retry`,
        { method: 'POST', body: {} }
      ),
      createParamsPromise({ id: walletId, deliveryId })
    )

    expect(rateLimitMock).toHaveBeenCalled()
    expect(response.status).toBe(202)
    expect(reconcileMock).toHaveBeenCalledWith({ ids: [deliveryId] })
  })

  it('refuses to replay a webhook whose outcome is unknown', async () => {
    vi.mocked(
      prismaMock.remoteWalletNotificationDelivery.findFirst
    ).mockResolvedValue(delivery({ status: 'UNKNOWN' }) as never)

    const response = await RETRY_DELIVERY(
      createNextRequest(
        `/api/remote-wallets/${walletId}/notification-deliveries/${deliveryId}/retry`,
        { method: 'POST', body: {} }
      ),
      createParamsPromise({ id: walletId, deliveryId })
    )

    expect(response.status).toBe(409)
    expect(afterMock).not.toHaveBeenCalled()
  })
})
