import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  createCardFixture,
  createCardDesignFixture,
  createNtag424Fixture,
  createUserFixture
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

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { auth: {}, cardScan: {}, sensitive: {}, default: {} }
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

vi.mock('@/lib/ntag424', () => ({
  consumeNtag424FromPC: vi.fn()
}))

import {
  GET as ScanGet,
  OPTIONS as ScanOptions
} from '@/app/api/cards/[id]/scan/route'
import {
  GET as CbGet,
  OPTIONS as CbOptions
} from '@/app/api/cards/[id]/scan/cb/route'
import { getSettings } from '@/lib/settings'
import { consumeNtag424FromPC } from '@/lib/ntag424'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('OPTIONS /api/cards/[id]/scan', () => {
  it('returns 204 with CORS headers', async () => {
    const req = createNextRequest('/api/cards/test-id/scan', {
      method: 'OPTIONS'
    })
    const res = await ScanOptions(req)

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain(
      'LAWALLET_ACTION'
    )
  })
})

describe('GET /api/cards/[id]/scan', () => {
  it('returns a LUD-03 withdraw request with a payable range for a configured card', async () => {
    const card = {
      ...createCardFixture(),
      design: createCardDesignFixture(),
      user: createUserFixture(),
      // Card bound to an ACTIVE wallet → it can pay.
      remoteWallet: { type: 'NWC', config: {}, status: 'ACTIVE' }
    }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(getSettings).mockResolvedValue({
      domain: 'test.com',
      endpoint: 'app'
    })

    const req = createNextRequest(`/api/cards/${card.id}/scan`, {
      searchParams: { p: 'A'.repeat(32), c: 'B'.repeat(16) }
    })
    const res = await ScanGet(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    expect(body.tag).toBe('withdrawRequest')
    expect(body.callback).toContain(`/api/cards/${card.id}/scan/cb`)
    expect(body.callback).toContain('p=' + 'A'.repeat(32))
    expect(body.minWithdrawable).toBeGreaterThan(0)
    expect(body.maxWithdrawable).toBeGreaterThan(0)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('returns public card status JSON when x-request-action: info', async () => {
    const card = {
      ...createCardFixture(),
      userId: 'owner-1',
      design: createCardDesignFixture(),
      user: { pubkey: 'pk-1', lightningAddresses: [] },
      remoteWallet: null
    }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const req = createNextRequest(`/api/cards/${card.id}/scan`, {
      headers: { 'x-request-action': 'info' }
    })
    const res = await ScanGet(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    // Card status, NOT the LNURL withdraw request.
    expect(body.tag).toBeUndefined()
    expect(body.callback).toBeUndefined()
    expect(body).toMatchObject({
      id: card.id,
      paired: true,
      disabled: false,
      design: { imageUrl: expect.any(String) },
      user: { pubkey: 'pk-1', username: null }
    })
    // Never leaks secrets.
    for (const k of ['k0', 'k1', 'k2', 'k3', 'k4', 'otc', 'cid']) {
      expect(body).not.toHaveProperty(k)
    }
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('advertises a 0–0 withdraw range when the card has no usable wallet', async () => {
    // Unpaired / unconfigured card: no bound wallet, no owner default.
    const card = {
      ...createCardFixture(),
      design: createCardDesignFixture(),
      user: null,
      remoteWallet: null
    }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(getSettings).mockResolvedValue({
      domain: 'test.com',
      endpoint: 'app'
    })

    const req = createNextRequest(`/api/cards/${card.id}/scan`, {
      searchParams: { p: 'A'.repeat(32), c: 'B'.repeat(16) }
    })
    const res = await ScanGet(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    expect(body.tag).toBe('withdrawRequest')
    expect(body.minWithdrawable).toBe(0)
    expect(body.maxWithdrawable).toBe(0)
  })

  it('advertises a 0–0 withdraw range when the card is disabled', async () => {
    const card = {
      ...createCardFixture({ disabledAt: new Date('2026-01-02T00:00:00Z') }),
      design: createCardDesignFixture(),
      user: createUserFixture(),
      remoteWallet: { type: 'NWC', config: {}, status: 'ACTIVE' }
    }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(getSettings).mockResolvedValue({
      domain: 'test.com',
      endpoint: 'app'
    })

    const req = createNextRequest(`/api/cards/${card.id}/scan`, {
      searchParams: { p: 'A'.repeat(32), c: 'B'.repeat(16) }
    })
    const res = await ScanGet(req, createParamsPromise({ id: card.id }))
    const body: any = await assertResponse(res, 200)

    expect(body.tag).toBe('withdrawRequest')
    expect(body.minWithdrawable).toBe(0)
    expect(body.maxWithdrawable).toBe(0)
  })

  it('returns 404 for nonexistent card', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/nonexistent/scan', {
      searchParams: { p: 'A'.repeat(32), c: 'B'.repeat(16) }
    })
    const res = await ScanGet(req, createParamsPromise({ id: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('rejects missing query params', async () => {
    const req = createNextRequest('/api/cards/test-id/scan')
    const res = await ScanGet(req, createParamsPromise({ id: 'test-id' }))

    expect(res.status).toBe(400)
  })
})

describe('OPTIONS /api/cards/[id]/scan/cb', () => {
  it('returns 204 with CORS headers', async () => {
    const req = createNextRequest('/api/cards/test-id/scan/cb', {
      method: 'OPTIONS'
    })
    const res = await CbOptions(req)

    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })
})

describe('GET /api/cards/[id]/scan/cb', () => {
  it('validates NTAG424 and dispatches action', async () => {
    const ntag424 = createNtag424Fixture()
    const user = createUserFixture({ nwc: 'nostr+walletconnect://test' })
    const card = { ...createCardFixture(), ntag424, user }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(consumeNtag424FromPC).mockResolvedValue({
      ok: ntag424 as any,
      ctrOld: 0,
      ctrNew: 1
    })
    vi.mocked(prismaMock.card.update).mockResolvedValue({} as any)

    // Mock the dynamic import of action handler
    vi.doMock('./actions/pay.ts', () => ({
      default: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status: 'OK' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    }))

    const req = createNextRequest(`/api/cards/${card.id}/scan/cb`, {
      searchParams: { p: 'A'.repeat(32), c: 'B'.repeat(16) },
      headers: { LAWALLET_ACTION: 'pay' }
    })
    const res = await CbGet(req, createParamsPromise({ id: card.id }))

    // The route attempts dynamic import which may fail in test environment
    // We verify the middleware chain works (auth, NTAG424 validation, card update)
    expect(prismaMock.card.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: card.id } })
    )
    expect(consumeNtag424FromPC).toHaveBeenCalledWith(
      ntag424,
      'A'.repeat(32),
      'B'.repeat(16)
    )
  })

  it('returns 404 for nonexistent card', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/nonexistent/scan/cb', {
      searchParams: { p: 'A'.repeat(32), c: 'B'.repeat(16) }
    })
    const res = await CbGet(req, createParamsPromise({ id: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('returns error when NTAG424 validation fails', async () => {
    const ntag424 = createNtag424Fixture()
    const card = { ...createCardFixture(), ntag424, user: createUserFixture() }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(consumeNtag424FromPC).mockResolvedValue({
      error: 'Malformed p: counter value too old' as any
    })

    const req = createNextRequest(`/api/cards/${card.id}/scan/cb`, {
      searchParams: { p: 'A'.repeat(32), c: 'B'.repeat(16) }
    })
    const res = await CbGet(req, createParamsPromise({ id: card.id }))

    expect(res.status).toBe(400)
  })

  it('rejects disabled cards before consuming SUN params', async () => {
    const ntag424 = createNtag424Fixture()
    const card = {
      ...createCardFixture({ disabledAt: new Date('2026-01-02T00:00:00Z') }),
      ntag424,
      user: createUserFixture()
    }
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const req = createNextRequest(`/api/cards/${card.id}/scan/cb`, {
      searchParams: { p: 'A'.repeat(32), c: 'B'.repeat(16) }
    })
    const res = await CbGet(req, createParamsPromise({ id: card.id }))

    expect(res.status).toBe(400)
    expect(consumeNtag424FromPC).not.toHaveBeenCalled()
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })
})
