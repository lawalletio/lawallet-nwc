import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const { postNotificationWebhook } = vi.hoisted(() => ({
  postNotificationWebhook: vi.fn()
}))

vi.mock('@/lib/remote-wallet-notifications/webhook', () => ({
  postNotificationWebhook
}))
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}))

import { reconcileRemoteWalletNotifications } from '@/lib/remote-wallet-notifications/reconcile'

function webhookDelivery() {
  return {
    id: 'delivery-1',
    walletId: 'wallet-1',
    notificationId: 'notification-1',
    eventKey: 'event-1',
    action: 'RECEIVED',
    payload: { ok: true },
    status: 'PENDING',
    attemptCount: 0,
    leaseOwner: 'worker-1',
    leaseExpiresAt: new Date(Date.now() + 60_000),
    nextRetryAt: new Date(),
    lastError: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    attempts: [],
    notification: {
      id: 'notification-1',
      enabled: true,
      channel: 'WEBHOOK',
      webhookUrl: 'https://hooks.example/hook'
    }
  }
}

async function reconcileWebhookFailure(error: Error) {
  postNotificationWebhook.mockRejectedValue(error)
  vi.mocked(prismaMock.$queryRaw).mockResolvedValue([{ id: 'delivery-1' }])
  vi.mocked(
    prismaMock.remoteWalletNotificationDelivery.findUnique
  ).mockResolvedValue(webhookDelivery() as never)
  vi.mocked(
    prismaMock.remoteWalletNotificationDelivery.findFirst
  ).mockResolvedValue({
    id: 'delivery-1',
    attemptCount: 0
  } as never)
  vi.mocked(
    prismaMock.remoteWalletNotificationAttempt.create
  ).mockResolvedValue({ id: 'attempt-1' } as never)

  await reconcileRemoteWalletNotifications({ workerId: 'worker-1' })
}

function deliveryStatusUpdates() {
  return vi
    .mocked(prismaMock.remoteWalletNotificationDelivery.updateMany)
    .mock.calls.map(call => call[0]?.data?.status)
}

describe('reconcileRemoteWalletNotifications webhook preflight', () => {
  beforeEach(() => {
    resetPrismaMock()
    postNotificationWebhook.mockReset()
  })

  it.each([
    'getaddrinfo ENOTFOUND hooks.example',
    'getaddrinfo EAI_AGAIN hooks.example',
    'getaddrinfo EAI_FAIL hooks.example',
    'getaddrinfo EAI_NODATA hooks.example',
    'Webhook DNS lookup timed out'
  ])(
    'retries webhook DNS failure %s instead of marking UNKNOWN',
    async message => {
      await reconcileWebhookFailure(new Error(message))

      expect(deliveryStatusUpdates()).toContain('REJECTED')
      expect(deliveryStatusUpdates()).not.toContain('UNKNOWN')
      expect(
        prismaMock.remoteWalletNotificationAttempt.update
      ).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },
        data: expect.objectContaining({
          status: 'REJECTED',
          errorMessage: message
        })
      })
    }
  )

  it('marks post-send transport errors UNKNOWN so they are not retried', async () => {
    await reconcileWebhookFailure(new Error('socket hang up'))

    expect(deliveryStatusUpdates()).toContain('UNKNOWN')
    expect(deliveryStatusUpdates()).not.toContain('REJECTED')
    expect(
      prismaMock.remoteWalletNotificationAttempt.update
    ).toHaveBeenCalledWith({
      where: { id: 'attempt-1' },
      data: expect.objectContaining({
        status: 'UNKNOWN',
        errorCode: 'transport_unknown'
      })
    })
  })
})
