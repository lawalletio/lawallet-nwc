import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createCardDesignFixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

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

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

vi.mock('@/mocks/card-design', () => ({
  mockCardDesignData: [{ id: 'existing-1' }, { id: 'existing-2' }],
}))

import { GET as ListGet } from '@/app/api/card-designs/list/route'
import { GET as CountGet } from '@/app/api/card-designs/count/route'
import { GET as GetById } from '@/app/api/card-designs/get/[id]/route'
import { POST as ImportPost } from '@/app/api/card-designs/import/route'
import { validateAdminAuth } from '@/lib/admin-auth'
import { getSettings } from '@/lib/settings'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/card-designs/list', () => {
  it('returns all card designs for admin', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    const design = createCardDesignFixture()
    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([design] as any)

    const req = createNextRequest('/api/card-designs/list')
    const res = await ListGet(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toHaveLength(1)
    expect(body[0].id).toBe(design.id)
  })

  it('returns empty array when no designs', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([])

    const req = createNextRequest('/api/card-designs/list')
    const res = await ListGet(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual([])
  })

  it('rejects non-admin', async () => {
    vi.mocked(validateAdminAuth).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/card-designs/list')
    const res = await ListGet(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('GET /api/card-designs/count', () => {
  it('returns count for admin', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(prismaMock.cardDesign.count).mockResolvedValue(42)

    const req = createNextRequest('/api/card-designs/count')
    const res = await CountGet(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ count: 42 })
  })

  it('rejects non-admin', async () => {
    vi.mocked(validateAdminAuth).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/card-designs/count')
    const res = await CountGet(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('GET /api/card-designs/get/[id]', () => {
  it('returns design by ID for admin', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    const design = createCardDesignFixture()
    vi.mocked(prismaMock.cardDesign.findUnique).mockResolvedValue(design as any)

    const req = createNextRequest(`/api/card-designs/get/${design.id}`)
    const res = await GetById(req, createParamsPromise({ id: design.id }))
    const body: any = await assertResponse(res, 200)

    expect(body.id).toBe(design.id)
  })

  it('returns 404 for nonexistent design', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(prismaMock.cardDesign.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/card-designs/get/nonexistent')
    const res = await GetById(req, createParamsPromise({ id: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('rejects non-admin', async () => {
    vi.mocked(validateAdminAuth).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/card-designs/get/some-id')
    const res = await GetById(req, createParamsPromise({ id: 'some-id' }))

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('POST /api/card-designs/import', () => {
  it('imports new designs from veintiuno.lat', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(getSettings).mockResolvedValue({
      is_community: 'true',
      community_id: 'comm-1',
    })

    // Mock global fetch for veintiuno.lat
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([
        { id: 'new-1', communityId: 'comm-1', imageUrl: 'https://img.com/1.png', description: 'Design 1' },
        { id: 'new-2', communityId: 'comm-1', imageUrl: 'https://img.com/2.png', description: 'Design 2' },
        { id: 'other-comm', communityId: 'comm-other', imageUrl: 'https://img.com/3.png', description: 'Other' },
      ]), { status: 200 })
    )

    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([]) // no existing
    vi.mocked(prismaMock.cardDesign.create).mockImplementation((async ({ data }: any) => ({
      id: data.id,
      imageUrl: data.imageUrl,
      description: data.description,
      createdAt: new Date(),
    })) as any)

    const req = createNextRequest('/api/card-designs/import', { method: 'POST' })
    const res = await ImportPost(req)
    const body: any = await assertResponse(res, 200)

    expect(body.success).toBe(true)
    expect(body.imported).toBe(2)
    expect(body.designs).toHaveLength(2)
  })

  it('skips already existing designs', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(getSettings).mockResolvedValue({
      is_community: 'true',
      community_id: 'comm-1',
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([
        { id: 'existing-1', communityId: 'comm-1', imageUrl: 'u', description: 'd' },
      ]), { status: 200 })
    )

    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([
      { id: 'existing-1' }, { id: 'existing-2' },
    ] as any)

    const req = createNextRequest('/api/card-designs/import', { method: 'POST' })
    const res = await ImportPost(req)
    const body: any = await assertResponse(res, 200)

    expect(body.imported).toBe(0)
    expect(prismaMock.cardDesign.create).not.toHaveBeenCalled()
  })

  it('rejects when community_id not set', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(getSettings).mockResolvedValue({})

    const req = createNextRequest('/api/card-designs/import', { method: 'POST' })
    const res = await ImportPost(req)

    expect(res.status).toBe(400)
  })

  it('handles veintiuno.lat fetch failure', async () => {
    vi.mocked(validateAdminAuth).mockResolvedValue('admin')
    vi.mocked(getSettings).mockResolvedValue({
      is_community: 'true',
      community_id: 'comm-1',
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 })
    )

    const req = createNextRequest('/api/card-designs/import', { method: 'POST' })
    const res = await ImportPost(req)

    expect(res.status).toBe(500)
  })

  it('rejects non-admin', async () => {
    vi.mocked(validateAdminAuth).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/card-designs/import', { method: 'POST' })
    const res = await ImportPost(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
