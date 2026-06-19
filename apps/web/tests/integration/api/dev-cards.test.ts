import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    card: { deleteMany: vi.fn() },
    ntag424: { deleteMany: vi.fn() },
  },
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}))

import { DELETE } from '@/app/api/dev/cards/route'
import { prisma } from '@/lib/prisma'
import { eventBus } from '@/lib/events/event-bus'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('DELETE /api/dev/cards', () => {
  it('wipes cards + ntag424 and reports counts in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.mocked(prisma.card.deleteMany).mockResolvedValue({ count: 3 } as any)
    vi.mocked(prisma.ntag424.deleteMany).mockResolvedValue({ count: 3 } as any)

    const res = await DELETE(createNextRequest('/api/dev/cards', { method: 'DELETE' }))
    const body: any = await assertResponse(res, 200)

    expect(body.deleted).toEqual({ cards: 3, ntag424: 3 })
    // Cards before ntag424 (FK: card references ntag424).
    expect(prisma.card.deleteMany).toHaveBeenCalled()
    expect(prisma.ntag424.deleteMany).toHaveBeenCalled()
    // Broadcasts so open /admin/cards tabs refetch in real time.
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cards:updated' })
    )
  })

  it.each(['production', 'test', 'staging', ''])(
    'is unavailable unless NODE_ENV is exactly "development" (%s → 404, no deletes)',
    async env => {
      vi.stubEnv('NODE_ENV', env)

      const res = await DELETE(createNextRequest('/api/dev/cards', { method: 'DELETE' }))

      expect(res.status).toBe(404)
      expect(prisma.card.deleteMany).not.toHaveBeenCalled()
      expect(eventBus.emit).not.toHaveBeenCalled()
    }
  )
})
