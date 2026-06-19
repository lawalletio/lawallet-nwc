import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { AuthenticationError } from '@/types/server/errors'

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

vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))
vi.mock('@/lib/user', () => ({ createNewUser: vi.fn() }))

import { GET as PreviewToken } from '@/app/api/activation-tokens/[id]/route'
import { POST as ClaimToken } from '@/app/api/activation-tokens/[id]/claim/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { createNewUser } from '@/lib/user'

const CLAIMER_PUBKEY = 'b'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

function mockClaimer(remoteWalletId: string | null = 'w1') {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: CLAIMER_PUBKEY,
    role: 'USER' as any,
    method: 'nip98',
  })
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
    id: 'user1',
    pubkey: CLAIMER_PUBKEY,
    remoteWallets: remoteWalletId ? [{ id: remoteWalletId }] : [],
  } as any)
}

const claimedCardRow = {
  id: 'card1',
  createdAt: new Date(),
  title: 'My Card',
  lastUsedAt: null,
  username: null,
  remoteWalletId: 'w1',
  kind: 'SIMPLE',
  design: { id: 'd1', imageUrl: 'https://img', description: 'Blue', createdAt: new Date() },
  user: { pubkey: CLAIMER_PUBKEY },
}

describe('GET /api/activation-tokens/[id] (preview)', () => {
  it('returns a secret-free preview with the card design and kind', async () => {
    vi.mocked(prismaMock.cardActivationToken.findUnique).mockResolvedValue({
      id: 'tok1',
      qrKind: 'ONE_TIME',
      status: 'PENDING',
      expiresAt: null,
      card: {
        id: 'card1',
        title: 'My Card',
        kind: 'SIMPLE',
        design: { id: 'd1', imageUrl: 'https://img', description: 'Blue' },
      },
    } as any)

    const req = createNextRequest('/api/activation-tokens/tok1')
    const res = await PreviewToken(req, createParamsPromise({ id: 'tok1' }))
    const body: any = await assertResponse(res, 200)

    expect(body.tokenId).toBe('tok1')
    expect(body.status).toBe('PENDING')
    expect(body.card.design.imageUrl).toBe('https://img')
    // No NTAG keys leak through the preview.
    expect(JSON.stringify(body)).not.toContain('k0')
  })

  it('reports an expired PENDING token as EXPIRED', async () => {
    vi.mocked(prismaMock.cardActivationToken.findUnique).mockResolvedValue({
      id: 'tok1',
      qrKind: 'ONE_TIME',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1000),
      card: { id: 'card1', title: null, kind: 'SIMPLE', design: { id: 'd1', imageUrl: 'x', description: 'y' } },
    } as any)

    const req = createNextRequest('/api/activation-tokens/tok1')
    const res = await PreviewToken(req, createParamsPromise({ id: 'tok1' }))
    const body: any = await assertResponse(res, 200)

    expect(body.status).toBe('EXPIRED')
  })

  it('returns 404 for an unknown token', async () => {
    vi.mocked(prismaMock.cardActivationToken.findUnique).mockResolvedValue(null as any)

    const req = createNextRequest('/api/activation-tokens/missing')
    const res = await PreviewToken(req, createParamsPromise({ id: 'missing' }))

    expect(res.status).toBe(404)
  })
})

describe('POST /api/activation-tokens/[id]/claim', () => {
  function mockPendingToken(overrides: Record<string, unknown> = {}) {
    vi.mocked(prismaMock.cardActivationToken.findUnique).mockResolvedValue({
      id: 'tok1',
      cardId: 'card1',
      qrKind: 'ONE_TIME',
      status: 'PENDING',
      expiresAt: null,
      ...overrides,
    } as any)
  }

  it('transfers card ownership, binds the default wallet, and burns the token', async () => {
    mockClaimer('w1')
    mockPendingToken()
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue(claimedCardRow as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', { method: 'POST', body: {} })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))
    const body: any = await assertResponse(res, 200)

    expect(body.qrKind).toBe('ONE_TIME')
    expect(body.card.id).toBe('card1')
    expect(prismaMock.cardActivationToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tok1', status: 'PENDING' },
        data: expect.objectContaining({ status: 'CLAIMED', claimedByUserId: 'user1' }),
      }),
    )
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card1' },
        data: { userId: 'user1', remoteWalletId: 'w1' },
      }),
    )
    // The default-wallet fallback only considers an ACTIVE default, so a
    // disabled/revoked default is never bound (would brick the card at tap).
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          remoteWallets: { where: { isDefault: true, status: 'ACTIVE' }, take: 1 },
        },
      }),
    )
    // Preview-safe card response — no NTAG keys.
    expect(JSON.stringify(body)).not.toContain('k0')
  })

  it('refuses to claim a blocked card and does not burn the token', async () => {
    mockClaimer('w1')
    mockPendingToken({ card: { blockedAt: new Date() } })

    const req = createNextRequest('/api/activation-tokens/tok1/claim', { method: 'POST', body: {} })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBe(409)
    expect(prismaMock.cardActivationToken.updateMany).not.toHaveBeenCalled()
  })

  it('leaves the card unbound when the claimer has no ACTIVE default wallet', async () => {
    // The ACTIVE-default filter returns no rows (e.g. the default is disabled).
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: CLAIMER_PUBKEY,
      role: 'USER' as any,
      method: 'nip98',
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user1',
      pubkey: CLAIMER_PUBKEY,
      remoteWallets: [],
    } as any)
    mockPendingToken()
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({ ...claimedCardRow, remoteWalletId: null } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', { method: 'POST', body: {} })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))
    await assertResponse(res, 200)

    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'user1', remoteWalletId: null } }),
    )
  })

  it('creates a fresh user on first claim and binds no wallet when none exists', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: CLAIMER_PUBKEY,
      role: 'USER' as any,
      method: 'nip98',
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null as any)
    vi.mocked(createNewUser).mockResolvedValue({ id: 'user2', pubkey: CLAIMER_PUBKEY, remoteWallets: [] } as any)
    mockPendingToken()
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({ ...claimedCardRow, remoteWalletId: null } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', { method: 'POST', body: {} })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))
    await assertResponse(res, 200)

    expect(createNewUser).toHaveBeenCalledWith(CLAIMER_PUBKEY)
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'user2', remoteWalletId: null } }),
    )
  })

  it('binds an explicitly chosen wallet that belongs to the claimer', async () => {
    mockClaimer('w1')
    mockPendingToken()
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'w2',
      userId: 'user1',
      status: 'ACTIVE',
    } as any)
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({ ...claimedCardRow, remoteWalletId: 'w2' } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: { remoteWalletId: 'w2' },
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))
    await assertResponse(res, 200)

    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: 'user1', remoteWalletId: 'w2' } }),
    )
  })

  it('rejects a wallet that does not belong to the claimer (400)', async () => {
    mockClaimer('w1')
    mockPendingToken()
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'w2',
      userId: 'someone-else',
      status: 'ACTIVE',
    } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: { remoteWalletId: 'w2' },
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBe(400)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('rejects an explicitly chosen inactive (disabled) wallet (400)', async () => {
    mockClaimer('w1')
    mockPendingToken()
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'w2',
      userId: 'user1',
      status: 'DISABLED',
    } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: { remoteWalletId: 'w2' },
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBe(400)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('returns 409 when the token was already claimed', async () => {
    mockClaimer('w1')
    mockPendingToken({ status: 'CLAIMED' })

    const req = createNextRequest('/api/activation-tokens/tok1/claim', { method: 'POST', body: {} })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBe(409)
  })

  it('returns 409 when a concurrent claim wins the burn race', async () => {
    mockClaimer('w1')
    mockPendingToken()
    // Token read as PENDING, but the scoped burn updates 0 rows.
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({ count: 0 } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', { method: 'POST', body: {} })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBe(409)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('returns 409 for an expired token', async () => {
    mockClaimer('w1')
    mockPendingToken({ expiresAt: new Date(Date.now() - 1000) })

    const req = createNextRequest('/api/activation-tokens/tok1/claim', { method: 'POST', body: {} })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBe(409)
  })

  it('rejects an unauthenticated claim', async () => {
    vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('nope'))

    const req = createNextRequest('/api/activation-tokens/tok1/claim', { method: 'POST', body: {} })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
