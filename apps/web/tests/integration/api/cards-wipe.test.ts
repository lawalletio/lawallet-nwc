import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  createCardFixture,
  createCardDesignFixture,
  createNtag424Fixture,
} from '@/tests/helpers/fixtures'
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

vi.mock('@/lib/ntag424', () => ({
  cardToNtag424WipeData: vi.fn(),
}))

import { GET, OPTIONS } from '@/app/api/cards/[id]/wipe/route'
import { cardToNtag424WipeData } from '@/lib/ntag424'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('OPTIONS /api/cards/[id]/wipe', () => {
  it('returns 204 with CORS headers', async () => {
    const req = createNextRequest('/api/cards/test-id/wipe', { method: 'OPTIONS' })
    const res = await OPTIONS(req)

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('GET /api/cards/[id]/wipe', () => {
  it('returns the BoltCard wipe payload for a card', async () => {
    const ntag424 = createNtag424Fixture()
    const card = { ...createCardFixture(), design: createCardDesignFixture(), ntag424 }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(cardToNtag424WipeData).mockReturnValue({
      action: 'wipe',
      k0: ntag424.k0,
      k1: ntag424.k1,
      k2: ntag424.k2,
      k3: ntag424.k3,
      k4: ntag424.k4,
      uid: ntag424.cid,
      version: 1,
    } as any)

    const req = createNextRequest(`/api/cards/${card.id}/wipe`)
    const res = await GET(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    // BoltCard-compatible reset payload: action + current keys + UID.
    expect(body.action).toBe('wipe')
    expect(body.uid).toBe(ntag424.cid)
    expect(body.k0).toBeDefined()
    expect(body.version).toBe(1)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    // Resetting the card unpairs it AND marks it blocked (decommissioned).
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: card.id },
        data: expect.objectContaining({
          userId: null,
          username: null,
          remoteWalletId: null,
          blockedAt: expect.any(Date),
        }),
      })
    )
  })

  it('stays re-fetchable on an already-blocked card and preserves the block time', async () => {
    // Keys can be revealed as many times as needed (to reset the physical
    // card); the original `blockedAt` is carried forward, not reset.
    const blockedAt = new Date('2026-01-02T03:04:05.000Z')
    const ntag424 = createNtag424Fixture()
    const card = {
      ...createCardFixture({ blockedAt }),
      design: createCardDesignFixture(),
      ntag424,
    }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(cardToNtag424WipeData).mockReturnValue({
      action: 'wipe',
      k0: ntag424.k0,
      uid: ntag424.cid,
      version: 1,
    } as any)

    const req = createNextRequest(`/api/cards/${card.id}/wipe`)
    const res = await GET(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    // Still returns the keys (re-displayable)...
    expect(body.k0).toBeDefined()
    // ...and keeps the ORIGINAL blocked timestamp, not a fresh one.
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ blockedAt }),
      })
    )
  })

  it('returns 404 for nonexistent card', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/nonexistent/wipe')
    const res = await GET(req, createParamsPromise({ id: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('returns 400 when card has no NTAG424 data', async () => {
    const card = { ...createCardFixture(), design: createCardDesignFixture(), ntag424: null }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const req = createNextRequest(`/api/cards/${card.id}/wipe`)
    const res = await GET(req, createParamsPromise({ id: card.id }))

    expect(res.status).toBe(400)
  })
})
