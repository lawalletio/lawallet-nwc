import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createCardFixture, createCardDesignFixture, createNtag424Fixture } from '@/tests/helpers/fixtures'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/admin-auth', () => ({
  validateAdminAuth: vi.fn(),
}))

vi.mock('@/lib/ntag424', () => ({
  generateNtag424Values: vi.fn(() => ({
    cid: 'AABBCCDDEE1122',
    k0: '0'.repeat(32),
    k1: '1'.repeat(32),
    k2: '2'.repeat(32),
    k3: '3'.repeat(32),
    k4: '4'.repeat(32),
    ctr: 0,
  })),
}))

import { GET, POST } from '@/app/api/cards/route'
import { validateAdminAuth } from '@/lib/admin-auth'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/cards', () => {
  it('returns all cards for admin', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin-pubkey')
    const design = createCardDesignFixture()
    const ntag424 = createNtag424Fixture()
    const card = { ...createCardFixture(), design, ntag424, user: { pubkey: 'a'.repeat(64) } }
    vi.mocked(prismaMock.card.findMany).mockResolvedValue([card] as any)

    const req = createNextRequest('/api/cards')
    const res = await GET(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toHaveLength(1)
    expect(body[0].id).toBe(card.id)
  })

  it('filters by paired=true', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin-pubkey')
    vi.mocked(prismaMock.card.findMany).mockResolvedValue([])

    const req = createNextRequest('/api/cards', { searchParams: { paired: 'true' } })
    const res = await GET(req)
    await assertResponse(res, 200)

    expect(prismaMock.card.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ otc: { not: null } }),
      })
    )
  })

  it('filters by used=false', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin-pubkey')
    vi.mocked(prismaMock.card.findMany).mockResolvedValue([])

    const req = createNextRequest('/api/cards', { searchParams: { used: 'false' } })
    const res = await GET(req)
    await assertResponse(res, 200)

    expect(prismaMock.card.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lastUsedAt: { equals: null } }),
      })
    )
  })

  it('returns empty array when no cards', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin-pubkey')
    vi.mocked(prismaMock.card.findMany).mockResolvedValue([])

    const req = createNextRequest('/api/cards')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual([])
  })

  it('rejects non-admin', async () => {
    vi.mocked(validateAdminAuth).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/cards')
    const res = await GET(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('POST /api/cards', () => {
  it('creates a new card with NTAG424 values', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin-pubkey')
    const ntag = createNtag424Fixture({ cid: 'AABBCCDDEE1122' })
    vi.mocked(prismaMock.ntag424.create).mockResolvedValue(ntag as any)

    const createdCard = {
      id: 'card-id',
      createdAt: new Date(),
      title: 'New Card',
      lastUsedAt: null,
      username: null,
      otc: 'random-otc',
      design: createCardDesignFixture(),
      ntag424: ntag,
      user: null,
    }
    vi.mocked(prismaMock.card.create).mockResolvedValue(createdCard as any)

    const req = createNextRequest('/api/cards', {
      method: 'POST',
      body: { id: 'AA:BB:CC:DD:EE:11:22', designId: 'design-1' },
    })
    const res = await POST(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toMatchObject({ title: 'New Card' })
    expect(prismaMock.ntag424.create).toHaveBeenCalled()
    expect(prismaMock.card.create).toHaveBeenCalled()
  })

  it('rejects missing designId', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin-pubkey')

    const req = createNextRequest('/api/cards', {
      method: 'POST',
      body: { id: 'AABBCCDDEE1122' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('rejects non-admin', async () => {
    vi.mocked(validateAdminAuth).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/cards', {
      method: 'POST',
      body: { id: 'AABBCC', designId: 'd1' },
    })
    const res = await POST(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('rejects missing card id', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin-pubkey')

    const req = createNextRequest('/api/cards', {
      method: 'POST',
      body: { designId: 'design-1' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })
})
