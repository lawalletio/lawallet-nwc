import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  createCardFixture,
  createCardDesignFixture,
  createNtag424Fixture
} from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

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

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

vi.mock('@/lib/ntag424', () => ({
  cardToNtag424WriteData: vi.fn()
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
    const req = createNextRequest('/api/cards/test-id/write', {
      method: 'OPTIONS'
    })
    const res = await OPTIONS(req)

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('GET /api/cards/[id]/write', () => {
  const VALID_TOKEN = 'tok_valid_123'

  // A fresh (never-tapped) card carrying a valid, unexpired write token.
  function tokenedCard(overrides: Record<string, unknown> = {}) {
    return {
      ...createCardFixture(),
      design: createCardDesignFixture(),
      ntag424: createNtag424Fixture(),
      writeToken: VALID_TOKEN,
      writeTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      ...overrides
    }
  }

  it('returns NTAG424 write data with a valid token, unpairing + consuming it', async () => {
    const card = tokenedCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    // The atomic compare-and-consume updates exactly one row (the happy path).
    vi.mocked(prismaMock.card.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(getSettings).mockResolvedValue({
      domain: 'test.com',
      endpoint: ''
    })
    vi.mocked(cardToNtag424WriteData).mockReturnValue({
      card_name: 'Test Card',
      k0: card.ntag424.k0,
      lnurlw_base: `lnurlw://test.com/api/cards/${card.id}/scan`,
      protocol_name: 'new_bolt_card_response',
      protocol_version: '1'
    } as any)

    const req = createNextRequest(
      `/api/cards/${card.id}/write?token=${VALID_TOKEN}`
    )
    const res = await GET(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    expect(body.protocol_name).toBe('new_bolt_card_response')
    expect(body.k0).toBeDefined()
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    // The consume is an atomic compare-and-consume `updateMany` whose `where`
    // re-asserts the token matches, is unexpired, and the card is still fresh
    // — this is what makes a concurrent replay fail loudly instead of leaking
    // the keys a second time.
    expect(prismaMock.card.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: card.id,
          writeToken: VALID_TOKEN,
          writeTokenExpiresAt: { gt: expect.any(Date) },
          lastUsedAt: null,
          blockedAt: null
        },
        data: { writeToken: null, writeTokenExpiresAt: null }
      })
    )
    // Exporting the keys unpairs the card from any user — including dropping
    // the MASTER designation, which belongs to the account it just left.
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: card.id },
        data: {
          userId: null,
          username: null,
          remoteWalletId: null,
          kind: 'SIMPLE'
        }
      })
    )
    // The keys are built from a fresh re-read taken under the transaction
    // (after the consume), not the pre-transaction snapshot.
    expect(prismaMock.card.findUnique).toHaveBeenCalledTimes(2)
  })

  it('returns 403 when a concurrent request already consumed the token (atomic compare-and-consume)', async () => {
    // The snapshot still carries a valid token, so the non-locking pre-check
    // passes for BOTH overlapping requests. The fix lives in the consume:
    // request A nulls `writeToken` first, so request B's `updateMany` matches
    // 0 rows and is rejected loudly — instead of both silently returning keys.
    const card = tokenedCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(prismaMock.card.updateMany).mockResolvedValue({ count: 0 } as any)

    const req = createNextRequest(
      `/api/cards/${card.id}/write?token=${VALID_TOKEN}`
    )
    const res = await GET(req, createParamsPromise({ id: card.id }))

    expect(res.status).toBe(403)
    // The consume was attempted atomically...
    expect(prismaMock.card.updateMany).toHaveBeenCalledTimes(1)
    // ...but the throw happened before unpairing or exporting the keys.
    expect(prismaMock.card.update).not.toHaveBeenCalled()
    expect(prismaMock.ntag424.update).not.toHaveBeenCalled()
    expect(cardToNtag424WriteData).not.toHaveBeenCalled()
  })

  it('builds the response from the fresh re-read inside the transaction, not the pre-transaction snapshot', async () => {
    // Distinguish the snapshot read from the in-transaction re-read: the keys
    // returned must come from the row freshly read after the consume, so an
    // earlier transaction that burned the token can't surface stale keys.
    const snapshot = tokenedCard()
    const fresh = tokenedCard({
      title: 'Fresh After Consume',
      ntag424: { ...snapshot.ntag424, k0: 'ff'.repeat(16) }
    })
    vi.mocked(prismaMock.card.findUnique)
      .mockResolvedValueOnce(snapshot as any)
      .mockResolvedValueOnce(fresh as any)
    vi.mocked(prismaMock.card.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: '', endpoint: '' })

    const req = createNextRequest(
      `/api/cards/${snapshot.id}/write?token=${VALID_TOKEN}`
    )
    await GET(req, createParamsPromise({ id: snapshot.id }))

    expect(cardToNtag424WriteData).toHaveBeenCalledWith(
      fresh.ntag424,
      snapshot.id,
      fresh.title,
      expect.any(String)
    )
    expect(cardToNtag424WriteData).not.toHaveBeenCalledWith(
      snapshot.ntag424,
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  it('returns 403 (and exports nothing) when no token is supplied', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(
      tokenedCard() as any
    )

    const req = createNextRequest('/api/cards/card-1/write')
    const res = await GET(req, createParamsPromise({ id: 'card-1' }))

    expect(res.status).toBe(403)
    // The pre-check rejects before the transaction, so neither the atomic
    // consume nor any unpair runs.
    expect(prismaMock.card.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('returns 403 when the token does not match', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(
      tokenedCard() as any
    )

    const req = createNextRequest('/api/cards/card-1/write?token=wrong')
    const res = await GET(req, createParamsPromise({ id: 'card-1' }))

    expect(res.status).toBe(403)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('returns 403 when the token is expired', async () => {
    const expired = tokenedCard({
      writeTokenExpiresAt: new Date(Date.now() - 1000)
    })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(expired as any)

    const req = createNextRequest(
      `/api/cards/card-1/write?token=${VALID_TOKEN}`
    )
    const res = await GET(req, createParamsPromise({ id: 'card-1' }))

    expect(res.status).toBe(403)
  })

  it('returns 403 when the card has already been tapped, even with a matching token', async () => {
    const tapped = tokenedCard({
      lastUsedAt: new Date(),
      ntag424: { ...createNtag424Fixture(), ctr: 3 }
    })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(tapped as any)

    const req = createNextRequest(
      `/api/cards/card-1/write?token=${VALID_TOKEN}`
    )
    const res = await GET(req, createParamsPromise({ id: 'card-1' }))

    expect(res.status).toBe(403)
    // Pre-check rejects a non-fresh card before any DB write.
    expect(prismaMock.card.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('returns 404 for nonexistent card', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest(
      `/api/cards/nonexistent/write?token=${VALID_TOKEN}`
    )
    const res = await GET(req, createParamsPromise({ id: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('returns 400 when card has no NTAG424 data', async () => {
    const card = {
      ...createCardFixture(),
      design: createCardDesignFixture(),
      ntag424: null
    }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const req = createNextRequest(
      `/api/cards/${card.id}/write?token=${VALID_TOKEN}`
    )
    const res = await GET(req, createParamsPromise({ id: card.id }))

    expect(res.status).toBe(400)
  })

  it('ignores the domain for lnurlw_base host — falls back to the request host when no endpoint', async () => {
    const card = tokenedCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(prismaMock.card.updateMany).mockResolvedValue({ count: 1 } as any)
    // domain is set but endpoint is NOT: the chip's lnurlw_base host must be the
    // API host the wallet can actually reach on tap (here the request host),
    // never the lightning-address domain (which need not serve the API).
    vi.mocked(getSettings).mockResolvedValue({
      domain: 'example.com',
      endpoint: ''
    })
    vi.mocked(cardToNtag424WriteData).mockReturnValue({
      lnurlw_base: 'test'
    } as any)

    const req = createNextRequest(
      `/api/cards/${card.id}/write?token=${VALID_TOKEN}`
    )
    await GET(req, createParamsPromise({ id: card.id }))

    expect(cardToNtag424WriteData).toHaveBeenCalledWith(
      expect.anything(), // ntag424
      expect.anything(), // cardId
      expect.anything(), // title
      'localhost:3000' // request-host fallback — NOT 'example.com'
    )
  })

  it('uses endpoint URL host for lnurlw_base host', async () => {
    const card = tokenedCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(prismaMock.card.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(getSettings).mockResolvedValue({
      domain: 'example.com',
      endpoint: 'https://app.example.com'
    })
    vi.mocked(cardToNtag424WriteData).mockReturnValue({
      lnurlw_base: 'test'
    } as any)

    const req = createNextRequest(
      `/api/cards/${card.id}/write?token=${VALID_TOKEN}`
    )
    await GET(req, createParamsPromise({ id: card.id }))

    expect(cardToNtag424WriteData).toHaveBeenCalledWith(
      expect.anything(), // ntag424
      expect.anything(), // cardId
      expect.anything(), // title
      'app.example.com' // host
    )
  })
})
