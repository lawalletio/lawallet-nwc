import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
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

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/middleware/request-limits', () => ({ checkRequestLimits: vi.fn() }))
vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn(),
}))
vi.mock('@/lib/public-url', () => ({
  // The write-token URL now derives from the API endpoint, not the public
  // lightning-address domain (so the `/write` call it targets is reachable).
  resolveApiUrl: vi.fn(async () => 'https://test.com'),
}))

import { POST } from '@/app/api/cards/[id]/write-token/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(authenticateWithPermission).mockResolvedValue({ pubkey: 'x' } as any)
})

describe('POST /api/cards/[id]/write-token', () => {
  it('mints a single-use tokenized /write URL for a fresh card', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1',
      lastUsedAt: null,
      blockedAt: null,
      ntag424: { ctr: 0 },
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({} as any)

    const req = createNextRequest('/api/cards/card-1/write-token', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req, createParamsPromise({ id: 'card-1' }))
    const body: any = await assertResponse(res, 200)

    expect(body.url).toMatch(
      /^https:\/\/test\.com\/api\/cards\/card-1\/write\?token=[a-f0-9]+$/,
    )
    // The raw token is returned too, and matches the one embedded in the url —
    // clients on a different host build their own baseUrl-anchored write URL.
    expect(body.token).toMatch(/^[a-f0-9]+$/)
    expect(body.url).toContain(`token=${body.token}`)
    expect(body.expiresAt).toBeDefined()
    // The token is persisted on the card (with an expiry).
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card-1' },
        data: expect.objectContaining({
          writeToken: expect.any(String),
          writeTokenExpiresAt: expect.any(Date),
        }),
      }),
    )
  })

  it('requires CARDS_WRITE', async () => {
    // The route awaits authenticateWithPermission(req, CARDS_WRITE); ensure it
    // is invoked with that permission before any DB work.
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1',
      lastUsedAt: null,
      blockedAt: null,
      ntag424: { ctr: 0 },
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({} as any)

    const req = createNextRequest('/api/cards/card-1/write-token', {
      method: 'POST',
      body: {},
    })
    await POST(req, createParamsPromise({ id: 'card-1' }))

    expect(authenticateWithPermission).toHaveBeenCalledWith(
      expect.anything(),
      'cards:write',
    )
  })

  it('returns 409 for a card that has already been tapped', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1',
      lastUsedAt: new Date(),
      blockedAt: null,
      ntag424: { ctr: 2 },
    } as any)

    const req = createNextRequest('/api/cards/card-1/write-token', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req, createParamsPromise({ id: 'card-1' }))

    expect(res.status).toBe(409)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('returns 409 for a blocked card (reset keys exported)', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1',
      lastUsedAt: null,
      blockedAt: new Date(),
      ntag424: { ctr: 0 },
    } as any)

    const req = createNextRequest('/api/cards/card-1/write-token', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req, createParamsPromise({ id: 'card-1' }))

    expect(res.status).toBe(409)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('returns 404 for a nonexistent card', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/nope/write-token', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req, createParamsPromise({ id: 'nope' }))

    expect(res.status).toBe(404)
  })

  it('returns 400 when the card has no NTAG424 data', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1',
      lastUsedAt: null,
      blockedAt: null,
      ntag424: null,
    } as any)

    const req = createNextRequest('/api/cards/card-1/write-token', {
      method: 'POST',
      body: {},
    })
    const res = await POST(req, createParamsPromise({ id: 'card-1' }))

    expect(res.status).toBe(400)
  })
})
