import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const envState = vi.hoisted(() => ({ days: 90 }))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))
vi.mock('@/lib/config/env', () => ({
  getEnvVar: vi.fn(() => envState.days)
}))

import { RETENTION_SETTING, runRetention } from '@/lib/maintenance/retention'

const DAY_MS = 24 * 60 * 60 * 1000
const now = new Date('2026-10-12T12:00:00Z')

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  envState.days = 90
  vi.mocked(prismaMock.$queryRaw).mockResolvedValue([
    { name: RETENTION_SETTING }
  ] as never)
  for (const model of [
    prismaMock.activityLog,
    prismaMock.forwardingHop,
    prismaMock.remoteWalletNotificationDelivery
  ]) {
    vi.mocked(model.deleteMany).mockResolvedValue({ count: 0 } as never)
  }
})

describe('runRetention', () => {
  it('deletes history older than the window in LIMITed batches', async () => {
    vi.mocked(prismaMock.activityLog.deleteMany)
      .mockResolvedValueOnce({ count: 1000 } as never)
      .mockResolvedValueOnce({ count: 4 } as never)
    vi.mocked(prismaMock.forwardingHop.deleteMany).mockResolvedValueOnce({
      count: 2
    } as never)
    vi.mocked(
      prismaMock.remoteWalletNotificationDelivery.deleteMany
    ).mockResolvedValueOnce({ count: 1 } as never)

    await expect(runRetention(now)).resolves.toEqual({
      activityLogs: 1004,
      forwardingHops: 2,
      notificationDeliveries: 1
    })

    const cutoff = new Date(now.getTime() - 90 * DAY_MS)
    expect(prismaMock.activityLog.deleteMany).toHaveBeenCalledTimes(2)
    expect(prismaMock.activityLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
      limit: 1000
    })
    expect(prismaMock.forwardingHop.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: cutoff } },
      limit: 1000
    })
    // Only finished deliveries; attempts cascade with them.
    expect(
      prismaMock.remoteWalletNotificationDelivery.deleteMany
    ).toHaveBeenCalledWith({
      where: {
        status: { in: ['SUCCEEDED', 'EXPIRED'] },
        updatedAt: { lt: cutoff }
      },
      limit: 1000
    })
  })

  it('never prunes deliveries inside the listener dedup window', async () => {
    // Deliveries are the (notification, eventKey) dedup key; dropping them
    // while the listener could still replay the event would re-notify.
    envState.days = 7

    await runRetention(now)

    expect(
      prismaMock.remoteWalletNotificationDelivery.deleteMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          updatedAt: { lt: new Date(now.getTime() - 31 * DAY_MS) }
        })
      })
    )
    expect(prismaMock.activityLog.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { createdAt: { lt: new Date(now.getTime() - 7 * DAY_MS) } }
      })
    )
  })

  it('skips when another run claimed this hour', async () => {
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([] as never)

    await expect(runRetention(now)).resolves.toBeNull()
    expect(prismaMock.activityLog.deleteMany).not.toHaveBeenCalled()
  })

  it('does nothing at all when retention is disabled', async () => {
    envState.days = 0

    await expect(runRetention(now)).resolves.toBeNull()
    expect(prismaMock.$queryRaw).not.toHaveBeenCalled()
    expect(prismaMock.activityLog.deleteMany).not.toHaveBeenCalled()
  })
})
