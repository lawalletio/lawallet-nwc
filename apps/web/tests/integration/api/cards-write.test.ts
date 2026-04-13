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

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

vi.mock('@/lib/ntag424', () => ({
  cardToNtag424WriteData: vi.fn(),
}))

import { GET, OPTIONS } from '@/app/api/cards/[id]/write/route'
import { getSettings } from '@/lib/settings'
import { cardToNtag424WriteData } from '@/lib/ntag424'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('OPTIONS /api/cards/[id]/write', () => {
  it('returns 204 with CORS headers', async () => {
    const req = createNextRequest('/api/cards/test-id/write', { method: 'OPTIONS' })
    const res = await OPTIONS(req)

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('GET /api/cards/[id]/write', () => {
  it('returns NTAG424 write data for card', async () => {
    const ntag424 = createNtag424Fixture()
    const design = createCardDesignFixture()
    const card = { ...createCardFixture(), design, ntag424 }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(getSettings).mockResolvedValue({ endpoint: 'https://test.com' })
    vi.mocked(cardToNtag424WriteData).mockReturnValue({
      card_name: 'Test Card',
      id: ntag424.cid,
      k0: ntag424.k0,
      k1: ntag424.k1,
      k2: ntag424.k2,
      k3: ntag424.k3,
      k4: ntag424.k4,
      lnurlw_base: `lnurlw://test.com/api/cards/${card.id}/scan`,
      protocol_name: 'new_bolt_card_response',
      protocol_version: '1',
    } as any)

    const req = createNextRequest(`/api/cards/${card.id}/write`)
    const res = await GET(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    expect(body.protocol_name).toBe('new_bolt_card_response')
    expect(body.k0).toBeDefined()
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('returns 404 for nonexistent card', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/nonexistent/write')
    const res = await GET(req, createParamsPromise({ id: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('returns 400 when card has no NTAG424 data', async () => {
    const card = { ...createCardFixture(), design: createCardDesignFixture(), ntag424: null }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const req = createNextRequest(`/api/cards/${card.id}/write`)
    const res = await GET(req, createParamsPromise({ id: card.id }))

    expect(res.status).toBe(400)
  })

  it('strips protocol from endpoint for lnurlw_base', async () => {
    const ntag424 = createNtag424Fixture()
    const card = { ...createCardFixture(), design: createCardDesignFixture(), ntag424 }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(getSettings).mockResolvedValue({ endpoint: 'https://example.com' })
    vi.mocked(cardToNtag424WriteData).mockReturnValue({ lnurlw_base: 'test' } as any)

    const req = createNextRequest(`/api/cards/${card.id}/write`)
    await GET(req, createParamsPromise({ id: card.id }))

    expect(cardToNtag424WriteData).toHaveBeenCalledWith(
      expect.anything(),
      'example.com'
    )
  })
})
