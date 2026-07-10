import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createCardDesignFixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { Role } from '@/lib/auth/permissions'

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

// `/list`, `/count` and `/import` use the unified permission helper so that
// JWT-authenticated admin clients (the dashboard) can hit them. `/get/[id]`
// still runs through the legacy NIP-98 wrapper.
vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn(),
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
import {
  POST as ImportVeintiunoPost,
  DELETE as RemoveVeintiunoDelete,
} from '@/app/api/card-designs/import-veintiuno/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { validateAdminAuth } from '@/lib/admin-auth'
import { getSettings } from '@/lib/settings'

const mockAdmin = () =>
  vi.mocked(authenticateWithPermission).mockResolvedValue({
    pubkey: 'admin',
    role: Role.ADMIN,
    method: 'jwt',
  })

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('GET /api/card-designs/list', () => {
  it('returns all card designs for admin', async () => {
    mockAdmin()
    const design = createCardDesignFixture()
    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([design] as any)

    const req = createNextRequest('/api/card-designs/list')
    const res = await ListGet(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toHaveLength(1)
    expect(body[0].id).toBe(design.id)
  })

  it('returns empty array when no designs', async () => {
    mockAdmin()
    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([])

    const req = createNextRequest('/api/card-designs/list')
    const res = await ListGet(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual([])
  })

  it('rejects callers without CARD_DESIGNS_READ', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/card-designs/list')
    const res = await ListGet(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('GET /api/card-designs/count', () => {
  it('returns count for admin', async () => {
    mockAdmin()
    vi.mocked(prismaMock.cardDesign.count).mockResolvedValue(42)

    const req = createNextRequest('/api/card-designs/count')
    const res = await CountGet(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ count: 42 })
  })

  it('rejects callers without CARD_DESIGNS_READ', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(new Error('unauthorized'))

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
    mockAdmin()
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
    mockAdmin()
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
    mockAdmin()
    vi.mocked(getSettings).mockResolvedValue({})

    const req = createNextRequest('/api/card-designs/import', { method: 'POST' })
    const res = await ImportPost(req)

    expect(res.status).toBe(400)
  })

  it('handles veintiuno.lat fetch failure', async () => {
    mockAdmin()
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

  it('rejects callers without CARD_DESIGNS_WRITE', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/card-designs/import', { method: 'POST' })
    const res = await ImportPost(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('POST /api/card-designs/import-veintiuno', () => {
  const catalog = [
    // title wins over description as the design name.
    { id: 'veintiuno-1', communityId: 'a', imageUrl: 'https://v.lat/1.png', title: '#1 - A - artist', description: 'One' },
    { id: 'veintiuno-2', communityId: 'b', imageUrl: 'https://v.lat/2.png', title: 'Two' },
    // No filtering by community: a card from any community is imported.
    { id: 'veintiuno-3', communityId: 'c', imageUrl: 'https://v.lat/3.png' },
    // Malformed (no image) — skipped.
    { id: 'bad', communityId: 'c' },
  ]

  function mockCatalog() {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(catalog), { status: 200 }),
    )
  }

  it('upserts the whole catalog (all communities) on lawallet.io', async () => {
    mockAdmin()
    vi.mocked(getSettings).mockResolvedValue({ domain: 'lawallet.io' })
    mockCatalog()
    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([]) // none exist yet
    vi.mocked(prismaMock.cardDesign.upsert).mockResolvedValue({} as any)

    const req = createNextRequest('/api/card-designs/import-veintiuno', { method: 'POST' })
    const body: any = await assertResponse(await ImportVeintiunoPost(req), 200)

    expect(body.success).toBe(true)
    expect(body.imported).toBe(3) // the 3 valid cards; the malformed one is skipped
    expect(body.updated).toBe(0)
    expect(prismaMock.cardDesign.upsert).toHaveBeenCalledTimes(3)
  })

  it('reports existing designs as updated, not imported', async () => {
    mockAdmin()
    vi.mocked(getSettings).mockResolvedValue({ domain: 'lawallet.io' })
    mockCatalog()
    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([
      { id: 'veintiuno-1' },
    ] as any)
    vi.mocked(prismaMock.cardDesign.upsert).mockResolvedValue({} as any)

    const req = createNextRequest('/api/card-designs/import-veintiuno', { method: 'POST' })
    const body: any = await assertResponse(await ImportVeintiunoPost(req), 200)

    expect(body.imported).toBe(2)
    expect(body.updated).toBe(1)
  })

  it('allows the full catalog importer on non-lawallet domains in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    mockAdmin()
    vi.mocked(getSettings).mockResolvedValue({ domain: 'lacrypta.ar' })
    mockCatalog()
    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([])
    vi.mocked(prismaMock.cardDesign.upsert).mockResolvedValue({} as any)

    const req = createNextRequest('/api/card-designs/import-veintiuno', { method: 'POST' })
    const body: any = await assertResponse(await ImportVeintiunoPost(req), 200)

    expect(body.success).toBe(true)
    expect(body.imported).toBe(3)
    expect(prismaMock.cardDesign.upsert).toHaveBeenCalledTimes(3)
  })

  it('rejects when the instance domain is not lawallet.io', async () => {
    mockAdmin()
    vi.mocked(getSettings).mockResolvedValue({ domain: 'lacrypta.ar' })

    const req = createNextRequest('/api/card-designs/import-veintiuno', { method: 'POST' })
    const res = await ImportVeintiunoPost(req)

    expect(res.status).toBe(400)
    expect(globalThis.fetch).not.toHaveBeenCalled?.()
  })

  it('returns 500 when the catalog fetch fails', async () => {
    mockAdmin()
    vi.mocked(getSettings).mockResolvedValue({ domain: 'lawallet.io' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 502 }))

    const req = createNextRequest('/api/card-designs/import-veintiuno', { method: 'POST' })
    const res = await ImportVeintiunoPost(req)

    expect(res.status).toBe(500)
  })

  it('uses the card title as the design name (over description)', async () => {
    mockAdmin()
    vi.mocked(getSettings).mockResolvedValue({ domain: 'lawallet.io' })
    mockCatalog()
    vi.mocked(prismaMock.cardDesign.findMany).mockResolvedValue([])
    vi.mocked(prismaMock.cardDesign.upsert).mockResolvedValue({} as any)

    await assertResponse(
      await ImportVeintiunoPost(
        createNextRequest('/api/card-designs/import-veintiuno', { method: 'POST' }),
      ),
      200,
    )

    const call = vi
      .mocked(prismaMock.cardDesign.upsert)
      .mock.calls.find(([arg]: any) => arg.where.id === 'veintiuno-1')
    expect((call?.[0] as any).create.description).toBe('#1 - A - artist')
    expect((call?.[0] as any).update.description).toBe('#1 - A - artist')
  })

  it('rejects callers without CARD_DESIGNS_WRITE', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/card-designs/import-veintiuno', { method: 'POST' })
    const res = await ImportVeintiunoPost(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('DELETE /api/card-designs/import-veintiuno', () => {
  it('removes unused veintiuno designs and reports counts', async () => {
    mockAdmin()
    vi.mocked(prismaMock.cardDesign.count).mockResolvedValue(3) // 3 veintiuno designs exist
    vi.mocked(prismaMock.cardDesign.deleteMany).mockResolvedValue({ count: 2 } as any)

    const req = createNextRequest('/api/card-designs/import-veintiuno', { method: 'DELETE' })
    const body: any = await assertResponse(await RemoveVeintiunoDelete(req), 200)

    expect(body.removed).toBe(2)
    expect(body.skipped).toBe(1) // one is still used by a card
    // Only deletes veintiuno-prefixed designs that no card depends on.
    expect(prismaMock.cardDesign.deleteMany).toHaveBeenCalledWith({
      where: { id: { startsWith: 'veintiuno-' }, cards: { none: {} } },
    })
  })

  it('reports zero when there is nothing to remove', async () => {
    mockAdmin()
    vi.mocked(prismaMock.cardDesign.count).mockResolvedValue(0)
    vi.mocked(prismaMock.cardDesign.deleteMany).mockResolvedValue({ count: 0 } as any)

    const req = createNextRequest('/api/card-designs/import-veintiuno', { method: 'DELETE' })
    const body: any = await assertResponse(await RemoveVeintiunoDelete(req), 200)

    expect(body.removed).toBe(0)
    expect(body.skipped).toBe(0)
  })

  it('rejects callers without CARD_DESIGNS_WRITE', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/card-designs/import-veintiuno', { method: 'DELETE' })
    const res = await RemoveVeintiunoDelete(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
