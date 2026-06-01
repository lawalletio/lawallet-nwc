import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { AuthorizationError } from '@/types/server/errors'

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
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { auth: {}, cardScan: {}, sensitive: {}, default: {} },
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn(),
}))

vi.mock('@/lib/public-url', () => ({
  resolvePublicEndpoint: vi.fn(async () => ({
    host: 'test.example',
    url: 'https://test.example',
  })),
}))

import {
  POST as MintToken,
  GET as ListTokens,
} from '@/app/api/cards/[id]/activation-tokens/route'
import { POST as RescueCard } from '@/app/api/cards/[id]/rescue/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'

const ADMIN_PUBKEY = 'a'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

function mockAuth() {
  vi.mocked(authenticateWithPermission).mockResolvedValue({
    pubkey: ADMIN_PUBKEY,
    role: 'OPERATOR' as any,
    method: 'jwt',
  })
}

function mockAuthReject() {
  vi.mocked(authenticateWithPermission).mockRejectedValue(
    new AuthorizationError('Not authorized'),
  )
}

describe('POST /api/cards/[id]/activation-tokens', () => {
  it('mints a ONE_TIME token with a QR payload built from the public URL', async () => {
    mockAuth()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({ id: 'card1', kind: 'SIMPLE' } as any)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null as any)
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({ count: 0 } as any)
    vi.mocked(prismaMock.cardActivationToken.create).mockImplementation(
      async (args: any) => args.data,
    )

    const req = createNextRequest('/api/cards/card1/activation-tokens', {
      method: 'POST',
      body: { qrKind: 'ONE_TIME' },
    })
    const res = await MintToken(req, createParamsPromise({ id: 'card1' }))
    const body: any = await assertResponse(res, 201)

    expect(body.qrKind).toBe('ONE_TIME')
    expect(body.qrPayload).toMatch(/^https:\/\/test\.example\/activate\/[0-9a-f]{32}$/)
    // Replaces any prior active ONE_TIME token before inserting.
    expect(prismaMock.cardActivationToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cardId: 'card1', qrKind: 'ONE_TIME', status: 'PENDING' },
        data: { status: 'REVOKED' },
      }),
    )
    expect(prismaMock.cardActivationToken.create).toHaveBeenCalled()
  })

  it('rejects FOREVER QRs as not yet supported (400)', async () => {
    mockAuth()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({ id: 'card1', kind: 'MASTER' } as any)

    const req = createNextRequest('/api/cards/card1/activation-tokens', {
      method: 'POST',
      body: { qrKind: 'FOREVER' },
    })
    const res = await MintToken(req, createParamsPromise({ id: 'card1' }))

    expect(res.status).toBe(400)
    expect(prismaMock.cardActivationToken.create).not.toHaveBeenCalled()
  })

  it('returns 404 when the card does not exist', async () => {
    mockAuth()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null as any)

    const req = createNextRequest('/api/cards/missing/activation-tokens', {
      method: 'POST',
      body: { qrKind: 'ONE_TIME' },
    })
    const res = await MintToken(req, createParamsPromise({ id: 'missing' }))

    expect(res.status).toBe(404)
  })

  it('rejects callers without CARDS_WRITE', async () => {
    mockAuthReject()

    const req = createNextRequest('/api/cards/card1/activation-tokens', {
      method: 'POST',
      body: { qrKind: 'ONE_TIME' },
    })
    const res = await MintToken(req, createParamsPromise({ id: 'card1' }))

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

describe('GET /api/cards/[id]/activation-tokens', () => {
  it('lists only active (non-expired) PENDING tokens', async () => {
    mockAuth()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({ id: 'card1' } as any)
    vi.mocked(prismaMock.cardActivationToken.findMany).mockResolvedValue([
      {
        id: 'live',
        qrKind: 'ONE_TIME',
        qrPayload: 'https://test.example/activate/live',
        status: 'PENDING',
        expiresAt: null,
        createdAt: new Date(),
      },
      {
        id: 'stale',
        qrKind: 'ONE_TIME',
        qrPayload: 'https://test.example/activate/stale',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
        createdAt: new Date(),
      },
    ] as any)

    const req = createNextRequest('/api/cards/card1/activation-tokens')
    const res = await ListTokens(req, createParamsPromise({ id: 'card1' }))
    const body: any = await assertResponse(res, 200)

    expect(body).toHaveLength(1)
    expect(body[0].tokenId).toBe('live')
  })
})

describe('POST /api/cards/[id]/rescue', () => {
  it('revokes outstanding tokens, unassigns the card, and mints a fresh ONE_TIME token', async () => {
    mockAuth()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({ id: 'card1' } as any)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null as any)
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({ count: 2 } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({ id: 'card1' } as any)
    vi.mocked(prismaMock.cardActivationToken.create).mockImplementation(
      async (args: any) => args.data,
    )

    const req = createNextRequest('/api/cards/card1/rescue', { method: 'POST' })
    const res = await RescueCard(req, createParamsPromise({ id: 'card1' }))
    const body: any = await assertResponse(res, 201)

    expect(body.qrKind).toBe('ONE_TIME')
    expect(body.qrPayload).toMatch(/^https:\/\/test\.example\/activate\/[0-9a-f]{32}$/)
    // Card unassigned: holder + bound wallet cleared.
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card1' },
        data: { userId: null, remoteWalletId: null },
      }),
    )
  })

  it('returns 404 when the card does not exist', async () => {
    mockAuth()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null as any)

    const req = createNextRequest('/api/cards/missing/rescue', { method: 'POST' })
    const res = await RescueCard(req, createParamsPromise({ id: 'missing' }))

    expect(res.status).toBe(404)
  })
})
