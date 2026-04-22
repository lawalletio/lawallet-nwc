import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createCardFixture, createCardDesignFixture, createNtag424Fixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

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

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn(),
}))

import { GET, DELETE } from '@/app/api/cards/[id]/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'

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

describe('GET /api/cards/[id]', () => {
  it('returns card details for admin', async () => {
    mockAdmin()
    const design = createCardDesignFixture()
    const ntag424 = createNtag424Fixture()
    const card = { ...createCardFixture(), design, ntag424, user: { pubkey: 'a'.repeat(64) } }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const req = createNextRequest(`/api/cards/${card.id}`)
    const res = await GET(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    expect(body.id).toBe(card.id)
    expect(body.design).toBeDefined()
  })

  it('returns 404 for nonexistent card', async () => {
    mockAdmin()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/nonexistent')
    const res = await GET(req, createParamsPromise({ id: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('rejects non-admin', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/cards/some-id')
    const res = await GET(req, createParamsPromise({ id: 'some-id' }))

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('DELETE /api/cards/[id]', () => {
  it('deletes card and NTAG424 in transaction', async () => {
    mockAdmin()
    const card = createCardFixture({ ntag424Cid: 'ntag-cid-123' })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const req = createNextRequest(`/api/cards/${card.id}`, { method: 'DELETE' })
    const res = await DELETE(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    expect(body).toMatchObject({
      message: 'Card and associated NTAG424 deleted successfully',
      cardId: card.id,
      ntag424Cid: 'ntag-cid-123',
    })
  })

  it('returns 404 for nonexistent card', async () => {
    mockAdmin()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/nonexistent', { method: 'DELETE' })
    const res = await DELETE(req, createParamsPromise({ id: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('handles card without NTAG424', async () => {
    mockAdmin()
    const card = createCardFixture({ ntag424Cid: null })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const req = createNextRequest(`/api/cards/${card.id}`, { method: 'DELETE' })
    const res = await DELETE(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    expect(body.ntag424Cid).toBeNull()
  })

  it('rejects non-admin', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(new Error('unauthorized'))

    const req = createNextRequest('/api/cards/some-id', { method: 'DELETE' })
    const res = await DELETE(req, createParamsPromise({ id: 'some-id' }))

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
