import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { Role } from '@/lib/auth/permissions'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn()
}))

import { GET } from '@/app/api/cards/counts/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/cards/counts', () => {
  it('returns card counts for admin', async () => {
    vi.mocked(authenticateWithPermission).mockResolvedValue({
      pubkey: 'admin',
      role: Role.ADMIN,
      method: 'jwt'
    })
    // Postgres count(*) comes back as bigint; the route must coerce it.
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([
      {
        total: BigInt(15),
        paired: BigInt(10),
        unpaired: BigInt(5),
        used: BigInt(8),
        unused: BigInt(7),
        blocked: BigInt(2)
      }
    ])

    const req = createNextRequest('/api/cards/counts')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1)
    expect(prismaMock.card.count).not.toHaveBeenCalled()
    const sql = vi.mocked(prismaMock.$queryRaw).mock.calls[0][0] as unknown as
      TemplateStringsArray
    expect(sql.join('?')).toContain('FILTER (WHERE "userId" IS NOT NULL)')
    expect(body).toEqual({
      total: 15,
      paired: 10,
      unpaired: 5,
      used: 8,
      unused: 7,
      blocked: 2
    })
  })

  it('returns zero counts when no cards', async () => {
    vi.mocked(authenticateWithPermission).mockResolvedValue({
      pubkey: 'admin',
      role: Role.ADMIN,
      method: 'jwt'
    })
    const zero = BigInt(0)
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([
      {
        total: zero,
        paired: zero,
        unpaired: zero,
        used: zero,
        unused: zero,
        blocked: zero
      }
    ])

    const req = createNextRequest('/api/cards/counts')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      total: 0,
      paired: 0,
      unpaired: 0,
      used: 0,
      unused: 0,
      blocked: 0
    })
  })

  it('rejects callers without CARDS_READ permission', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(
      new Error('unauthorized')
    )

    const req = createNextRequest('/api/cards/counts')
    const res = await GET(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
