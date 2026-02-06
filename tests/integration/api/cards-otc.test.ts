import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createCardFixture, createCardDesignFixture, createUserFixture } from '@/tests/helpers/fixtures'
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

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { auth: {}, cardScan: {}, sensitive: {}, default: {} },
}))

vi.mock('@/lib/nip98', () => ({
  validateNip98: vi.fn(),
}))

vi.mock('@/lib/user', () => ({
  createNewUser: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

import { GET as GetOtc } from '@/app/api/cards/otc/[otc]/route'
import { POST as ActivateOtc } from '@/app/api/cards/otc/[otc]/activate/route'
import { validateNip98 } from '@/lib/nip98'
import { createNip98Result } from '@/tests/helpers/auth-helpers'
import { createNewUser } from '@/lib/user'
import { getSettings } from '@/lib/settings'

const mockPubkey = 'a'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/cards/otc/[otc]', () => {
  it('returns card by OTC', async () => {
    const design = createCardDesignFixture()
    const card = { ...createCardFixture({ otc: 'abc123' }), design, user: { pubkey: mockPubkey } }
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(card as any)

    const req = createNextRequest('/api/cards/otc/abc123')
    const res = await GetOtc(req, createParamsPromise({ otc: 'abc123' }))
    const body: any = await assertResponse(res, 200)

    expect(body.id).toBe(card.id)
  })

  it('returns 404 when OTC not found', async () => {
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/otc/nonexistent')
    const res = await GetOtc(req, createParamsPromise({ otc: 'nonexistent' }))

    expect(res.status).toBe(404)
  })

  it('does not include sensitive NTAG424 data', async () => {
    const design = createCardDesignFixture()
    const card = { ...createCardFixture(), design, user: { pubkey: mockPubkey } }
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(card as any)

    const req = createNextRequest('/api/cards/otc/abc123')
    const res = await GetOtc(req, createParamsPromise({ otc: 'abc123' }))
    const body: any = await assertResponse(res, 200)

    expect(body.ntag424).toBeUndefined()
  })
})

describe('POST /api/cards/otc/[otc]/activate', () => {
  it('activates card for authenticated user', async () => {
    vi.mocked(validateNip98).mockResolvedValue(createNip98Result(mockPubkey))
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddress: { username: 'alice' },
      albySubAccount: null,
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    const card = createCardFixture({ otc: 'abc123' })
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(card as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({} as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/cards/otc/abc123/activate', { method: 'POST' })
    const res = await ActivateOtc(req, createParamsPromise({ otc: 'abc123' }))
    const body: any = await assertResponse(res, 200)

    expect(body).toMatchObject({ userId: user.id, lightningAddress: 'alice@test.com' })
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: user.id } })
    )
  })

  it('creates user if not existing', async () => {
    vi.mocked(validateNip98).mockResolvedValue(createNip98Result(mockPubkey))
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
    const newUser = createUserFixture({
      pubkey: mockPubkey,
      lightningAddress: null,
      albySubAccount: null,
    })
    vi.mocked(createNewUser).mockResolvedValue(newUser as any)
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(createCardFixture() as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({} as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/cards/otc/abc123/activate', { method: 'POST' })
    const res = await ActivateOtc(req, createParamsPromise({ otc: 'abc123' }))
    await assertResponse(res, 200)

    expect(createNewUser).toHaveBeenCalledWith(mockPubkey)
  })

  it('rejects unauthenticated request', async () => {
    vi.mocked(validateNip98).mockRejectedValue(new Error('no auth'))

    const req = createNextRequest('/api/cards/otc/abc123/activate', { method: 'POST' })
    const res = await ActivateOtc(req, createParamsPromise({ otc: 'abc123' }))

    expect(res.status).toBe(401)
  })

  it('succeeds even if card not found for OTC', async () => {
    vi.mocked(validateNip98).mockResolvedValue(createNip98Result(mockPubkey))
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddress: null,
      albySubAccount: null,
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(prismaMock.card.findFirst).mockResolvedValue(null)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/cards/otc/bad-otc/activate', { method: 'POST' })
    const res = await ActivateOtc(req, createParamsPromise({ otc: 'bad-otc' }))
    const body: any = await assertResponse(res, 200)

    // Route still returns user data even if no card found
    expect(body.userId).toBe(user.id)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })
})
