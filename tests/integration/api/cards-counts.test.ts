import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/admin-auth', () => ({
  validateAdminAuth: vi.fn(),
}))

import { GET } from '@/app/api/cards/counts/route'
import { validateAdminAuth } from '@/lib/admin-auth'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/cards/counts', () => {
  it('returns card counts for admin', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(prismaMock.card.count)
      .mockResolvedValueOnce(10) // paired
      .mockResolvedValueOnce(5)  // unpaired
      .mockResolvedValueOnce(8)  // used
      .mockResolvedValueOnce(7)  // unused

    const req = createNextRequest('/api/cards/counts')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ paired: 10, unpaired: 5, used: 8, unused: 7 })
  })

  it('returns zero counts when no cards', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(prismaMock.card.count).mockResolvedValue(0)

    const req = createNextRequest('/api/cards/counts')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ paired: 0, unpaired: 0, used: 0, unused: 0 })
  })

  it('rejects non-admin', async () => {
    vi.mocked(validateAdminAuth).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/cards/counts')
    const res = await GET(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
