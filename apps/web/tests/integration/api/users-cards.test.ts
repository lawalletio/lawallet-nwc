import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createUserFixture, createCardFixture, createCardDesignFixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { AuthenticationError } from '@/types/server/errors'

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
  authenticate: vi.fn(),
}))

import { GET } from '@/app/api/users/[userId]/cards/route'
import { authenticate } from '@/lib/auth/unified-auth'

const mockPubkey = 'a'.repeat(64)

function mockAuth(pubkey: string = mockPubkey) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER' as any,
    method: 'nip98',
  })
}

function mockAuthReject() {
  vi.mocked(authenticate).mockRejectedValue(
    new AuthenticationError('no auth')
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/users/[userId]/cards', () => {
  it('returns cards for own user', async () => {
    const user = createUserFixture({ pubkey: mockPubkey })
    const design = createCardDesignFixture()
    const card = createCardFixture({ userId: user.id })

    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(prismaMock.card.findMany).mockResolvedValue([
      { ...card, design, user: { pubkey: mockPubkey } },
    ] as any)

    const req = createNextRequest(`/api/users/${user.id}/cards`)
    const res = await GET(req, createParamsPromise({ userId: user.id }))
    const body: any = await assertResponse(res, 200)

    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ id: card.id })
  })

  it('returns empty array when user has no cards', async () => {
    const user = createUserFixture({ pubkey: mockPubkey })
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(prismaMock.card.findMany).mockResolvedValue([])

    const req = createNextRequest(`/api/users/${user.id}/cards`)
    const res = await GET(req, createParamsPromise({ userId: user.id }))
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual([])
  })

  it('rejects when viewing another users cards', async () => {
    const otherUser = createUserFixture({ pubkey: 'b'.repeat(64) })
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(otherUser as any)

    const req = createNextRequest(`/api/users/${otherUser.id}/cards`)
    const res = await GET(req, createParamsPromise({ userId: otherUser.id }))

    expect(res.status).toBe(403)
  })

  it('returns 404 for nonexistent user', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/users/nonexistent/cards')
    const res = await GET(req, createParamsPromise({ userId: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('rejects unauthenticated request', async () => {
    mockAuthReject()

    const req = createNextRequest('/api/users/some-id/cards')
    const res = await GET(req, createParamsPromise({ userId: 'some-id' }))

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
