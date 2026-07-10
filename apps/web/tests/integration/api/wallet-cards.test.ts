import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { AuthenticationError } from '@/types/server/errors'

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

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn()
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    CARD_STATUS_UPDATED: 'card.status_updated',
    CARD_WALLET_BOUND: 'card.wallet_bound',
    NWC_ASSIGNED_TO_CARD: 'nwc.assigned_to_card'
  },
  logActivity: { fireAndForget: vi.fn() }
}))

import { GET as ListGet } from '@/app/api/wallet/cards/route'
import { PATCH as UpdateCard } from '@/app/api/wallet/cards/[id]/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

const mockPubkey = 'a'.repeat(64)

function mockAuth(pubkey = mockPubkey) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER' as any,
    method: 'jwt'
  })
}

function makeCardRow(overrides: Partial<any> = {}) {
  return {
    id: 'card-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    title: 'My Card',
    lastUsedAt: null,
    username: null,
    otc: null,
    remoteWalletId: null,
    kind: 'SIMPLE',
    blockedAt: null,
    disabledAt: null,
    design: {
      id: 'design-1',
      imageUrl: 'https://x/i.png',
      description: 'Design',
      createdAt: new Date('2026-01-01T00:00:00Z')
    },
    // No NTAG424 keys are ever selected by this endpoint.
    ntag424: {
      cid: 'CID',
      ctr: 3,
      createdAt: new Date('2026-01-01T00:00:00Z')
    },
    // Identity resolves from the owner's primary lightning address (via the
    // userId relation), NOT the dead Card.username column.
    user: { pubkey: mockPubkey, lightningAddresses: [{ username: 'alice' }] },
    ...overrides
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/wallet/cards', () => {
  it("returns only the caller's own cards, scoped by their userId", async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-1',
      pubkey: mockPubkey,
      remoteWallets: [{ id: 'wallet-default' }]
    } as any)
    vi.mocked(prismaMock.card.findMany).mockResolvedValue([
      makeCardRow()
    ] as any)

    const req = createNextRequest('/api/wallet/cards')
    const res = await ListGet(req)
    const body: any = await assertResponse(res, 200)

    // The query is filtered to the authenticated user's own cards.
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pubkey: mockPubkey } })
    )
    expect(prismaMock.card.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } })
    )

    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({
      id: 'card-1',
      pubkey: mockPubkey,
      // Resolved from the owner's primary lightning address via userId.
      username: 'alice',
      remoteWalletId: null,
      defaultRemoteWalletId: 'wallet-default',
      kind: 'SIMPLE',
      blocked: false,
      disabled: false
    })
  })

  it('never leaks NTAG424 keys in the response', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-1',
      pubkey: mockPubkey
    } as any)
    vi.mocked(prismaMock.card.findMany).mockResolvedValue([
      makeCardRow()
    ] as any)

    const req = createNextRequest('/api/wallet/cards')
    const res = await ListGet(req)
    const body: any = await assertResponse(res, 200)

    // The select asks only for cid/ctr/createdAt — the AES keys must not appear.
    for (const k of ['k0', 'k1', 'k2', 'k3', 'k4']) {
      expect(body[0].ntag424).not.toHaveProperty(k)
    }
    expect(body[0].ntag424).toMatchObject({ cid: 'CID', ctr: 3 })
  })

  it('returns an empty array when the user owns no cards', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-1',
      pubkey: mockPubkey
    } as any)
    vi.mocked(prismaMock.card.findMany).mockResolvedValue([] as any)

    const req = createNextRequest('/api/wallet/cards')
    const res = await ListGet(req)
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual([])
  })

  it('404s when the authenticated pubkey has no user record', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/wallet/cards')
    const res = await ListGet(req)

    expect(res.status).toBe(404)
    expect(prismaMock.card.findMany).not.toHaveBeenCalled()
  })

  it('propagates an authentication failure', async () => {
    vi.mocked(authenticate).mockRejectedValue(
      new AuthenticationError('no auth')
    )

    const req = createNextRequest('/api/wallet/cards')
    const res = await ListGet(req)

    expect(res.status).toBe(401)
  })
})

describe('PATCH /api/wallet/cards/[id]', () => {
  it('lets the caller disable their own card', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-1',
      pubkey: mockPubkey
    } as any)
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1',
      userId: 'user-1',
      blockedAt: null,
      disabledAt: null
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue(
      makeCardRow({ disabledAt: new Date('2026-01-02T00:00:00Z') }) as any
    )

    const req = createNextRequest('/api/wallet/cards/card-1', {
      method: 'PATCH',
      body: { enabled: false }
    })
    const res = await UpdateCard(req, createParamsPromise({ id: 'card-1' }))
    const body: any = await assertResponse(res, 200)

    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card-1' },
        data: { disabledAt: expect.any(Date) }
      })
    )
    expect(body).toMatchObject({ id: 'card-1', disabled: true })
  })

  it('lets the caller re-enable their own disabled card', async () => {
    const disabledAt = new Date('2026-01-02T00:00:00Z')
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-1',
      pubkey: mockPubkey
    } as any)
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1',
      userId: 'user-1',
      blockedAt: null,
      disabledAt
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue(
      makeCardRow({ disabledAt: null }) as any
    )

    const req = createNextRequest('/api/wallet/cards/card-1', {
      method: 'PATCH',
      body: { enabled: true }
    })
    const res = await UpdateCard(req, createParamsPromise({ id: 'card-1' }))
    const body: any = await assertResponse(res, 200)

    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { disabledAt: null } })
    )
    expect(body).toMatchObject({ id: 'card-1', disabled: false })
  })

  it('lets the caller bind their own card to their primary wallet', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-1',
      pubkey: mockPubkey,
      remoteWallets: [{ id: 'wallet-default' }]
    } as any)
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1',
      userId: 'user-1',
      remoteWalletId: null,
      blockedAt: null,
      disabledAt: null
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue(
      makeCardRow({ remoteWalletId: 'wallet-default' }) as any
    )

    const req = createNextRequest('/api/wallet/cards/card-1', {
      method: 'PATCH',
      body: { linkDefaultWallet: true }
    })
    const res = await UpdateCard(req, createParamsPromise({ id: 'card-1' }))
    const body: any = await assertResponse(res, 200)

    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card-1' },
        data: { remoteWalletId: 'wallet-default' }
      })
    )
    expect(body).toMatchObject({
      id: 'card-1',
      remoteWalletId: 'wallet-default',
      defaultRemoteWalletId: 'wallet-default'
    })
  })

  it('409s when binding without a primary wallet', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-1',
      pubkey: mockPubkey,
      remoteWallets: []
    } as any)
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1',
      userId: 'user-1',
      remoteWalletId: null,
      blockedAt: null,
      disabledAt: null
    } as any)

    const req = createNextRequest('/api/wallet/cards/card-1', {
      method: 'PATCH',
      body: { linkDefaultWallet: true }
    })
    const res = await UpdateCard(req, createParamsPromise({ id: 'card-1' }))

    expect(res.status).toBe(409)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it("404s instead of updating someone else's card", async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-1',
      pubkey: mockPubkey
    } as any)
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1',
      userId: 'user-2',
      blockedAt: null,
      disabledAt: null
    } as any)

    const req = createNextRequest('/api/wallet/cards/card-1', {
      method: 'PATCH',
      body: { enabled: false }
    })
    const res = await UpdateCard(req, createParamsPromise({ id: 'card-1' }))

    expect(res.status).toBe(404)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('rejects toggling a blocked card', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-1',
      pubkey: mockPubkey
    } as any)
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1',
      userId: 'user-1',
      blockedAt: new Date('2026-01-02T00:00:00Z'),
      disabledAt: null
    } as any)

    const req = createNextRequest('/api/wallet/cards/card-1', {
      method: 'PATCH',
      body: { enabled: false }
    })
    const res = await UpdateCard(req, createParamsPromise({ id: 'card-1' }))

    expect(res.status).toBe(409)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })
})
