import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const afterMock = vi.hoisted(() => vi.fn())
vi.mock('next/server', () => ({ after: afterMock }))
vi.mock('@/lib/logger', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  return {
    getCurrentReqId: vi.fn(() => 'req-1'),
    logger: { ...log, child: vi.fn(() => log) }
  }
})
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))

import { logActivity } from '@/lib/activity-log'
import { logger } from '@/lib/logger'

const input = {
  category: 'SERVER',
  event: 'test.event',
  message: 'hi'
} as const
const row = { id: 'log1', createdAt: new Date() }

beforeEach(() => {
  resetPrismaMock()
  afterMock.mockReset()
  vi.mocked(logger.error).mockClear()
})

describe('logActivity.fireAndForget', () => {
  it('starts the write now and hands it to after() so the platform waits', async () => {
    vi.mocked(prismaMock.activityLog.create).mockResolvedValue(row as any)

    logActivity.fireAndForget(input)

    expect(prismaMock.activityLog.create).toHaveBeenCalledOnce()
    expect(afterMock).toHaveBeenCalledOnce()
    const tracked = afterMock.mock.calls[0][0]
    expect(tracked).toBeInstanceOf(Promise)
    await expect(tracked).resolves.toMatchObject({ id: 'log1' })
  })

  it('falls back to an untracked write outside a request scope', async () => {
    vi.mocked(prismaMock.activityLog.create).mockResolvedValue(row as any)
    afterMock.mockImplementation(() => {
      throw new Error('`after` was called outside a request scope')
    })

    expect(() => logActivity.fireAndForget(input)).not.toThrow()
    expect(prismaMock.activityLog.create).toHaveBeenCalledOnce()
  })

  it('never throws or rejects when the write fails', async () => {
    vi.mocked(prismaMock.activityLog.create).mockRejectedValue(
      new Error('db down')
    )

    expect(() => logActivity.fireAndForget(input)).not.toThrow()
    // The promise given to after() swallows the failure, so Next never
    // reports it as an after() task error.
    await expect(afterMock.mock.calls[0][0]).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ activity_input: input }),
      'activity_log.write_failed'
    )
  })
})
