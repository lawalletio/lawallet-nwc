import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { AuthenticationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { auth: {}, cardScan: {}, sensitive: {}, default: {} }
}))

vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))
vi.mock('@/lib/user', () => ({ createNewUser: vi.fn() }))
vi.mock('@/lib/wallet/lncurl-wallet', () => ({
  createLncurlRemoteWallet: vi.fn().mockRejectedValue(new Error('lncurl off'))
}))
vi.mock('@/lib/wallet/drivers', () => ({
  driverForWallet: vi.fn()
}))

import { GET as PreviewToken } from '@/app/api/activation-tokens/[id]/route'
import { POST as ClaimToken } from '@/app/api/activation-tokens/[id]/claim/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { createNewUser } from '@/lib/user'
import { createLncurlRemoteWallet } from '@/lib/wallet/lncurl-wallet'
import { driverForWallet } from '@/lib/wallet/drivers'

const CLAIMER_PUBKEY = 'b'.repeat(64)

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

function mockClaimer(remoteWalletId: string | null = 'w1') {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: CLAIMER_PUBKEY,
    role: 'USER' as any,
    method: 'nip98'
  })
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
    id: 'user1',
    pubkey: CLAIMER_PUBKEY
  } as any)
  vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(
    remoteWalletId
      ? ({
          mode: 'CUSTOM_NWC',
          remoteWalletId,
          remoteWallet: {
            id: remoteWalletId,
            type: 'NWC',
            status: 'ACTIVE',
            config: { connectionString: 'nostr+walletconnect://primary' }
          }
        } as any)
      : null
  )
}

const claimedCardRow = {
  id: 'card1',
  createdAt: new Date(),
  title: 'My Card',
  lastUsedAt: null,
  username: null,
  remoteWalletId: 'w1',
  kind: 'SIMPLE',
  design: {
    id: 'd1',
    imageUrl: 'https://img',
    description: 'Blue',
    createdAt: new Date()
  },
  user: { pubkey: CLAIMER_PUBKEY }
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
        design: { id: 'd1', imageUrl: 'https://img', description: 'Blue' }
      }
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
      card: {
        id: 'card1',
        title: null,
        kind: 'SIMPLE',
        design: { id: 'd1', imageUrl: 'x', description: 'y' }
      }
    } as any)

    const req = createNextRequest('/api/activation-tokens/tok1')
    const res = await PreviewToken(req, createParamsPromise({ id: 'tok1' }))
    const body: any = await assertResponse(res, 200)

    expect(body.status).toBe('EXPIRED')
  })

  it('returns 404 for an unknown token', async () => {
    vi.mocked(prismaMock.cardActivationToken.findUnique).mockResolvedValue(
      null as any
    )

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
      ...overrides
    } as any)
  }

  it('resets the card to SIMPLE so the master designation never changes hands', async () => {
    // A card stamped MASTER in inventory (or handed on by a previous holder)
    // must not arrive already marked as the claimer's recovery card — that's
    // their decision to make. Resetting here also means assigning `userId` can
    // never collide with the Card_userId_master_unique partial index.
    mockClaimer('w1')
    mockPendingToken()
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 1
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue(claimedCardRow as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: {}
    })
    await assertResponse(
      await ClaimToken(req, createParamsPromise({ id: 'tok1' })),
      200
    )

    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card1' },
        data: expect.objectContaining({ kind: 'SIMPLE' })
      })
    )
    // No sibling demotion needed — nothing is ever promoted by a claim.
    expect(prismaMock.card.updateMany).not.toHaveBeenCalled()
  })

  it('transfers card ownership, binds the primary-address wallet, and burns the token', async () => {
    mockClaimer('w1')
    mockPendingToken()
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 1
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue(claimedCardRow as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: {}
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))
    const body: any = await assertResponse(res, 200)

    expect(body.qrKind).toBe('ONE_TIME')
    expect(body.card.id).toBe('card1')
    expect(body.needsLightningAddress).toBe(false)
    expect(body.bonuses.freeLightningAddress).toBe(false)
    expect(body.bonuses.sats.granted).toBe(false)
    expect(prismaMock.cardActivationToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tok1', status: 'PENDING' },
        data: expect.objectContaining({
          status: 'CLAIMED',
          claimedByUserId: 'user1'
        })
      })
    )
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card1' },
        data: { userId: 'user1', remoteWalletId: 'w1', kind: 'SIMPLE' }
      })
    )
    expect(prismaMock.lightningAddress.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user1', isPrimary: true },
        include: { remoteWallet: true }
      })
    )
    // Preview-safe card response — no NTAG keys.
    expect(JSON.stringify(body)).not.toContain('k0')
  })

  it('refuses to claim a blocked card and does not burn the token', async () => {
    mockClaimer('w1')
    mockPendingToken({ card: { blockedAt: new Date() } })

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: {}
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBe(409)
    expect(prismaMock.cardActivationToken.updateMany).not.toHaveBeenCalled()
  })

  it('leaves the card unbound when the claimer has no ACTIVE default wallet', async () => {
    // The ACTIVE-default filter returns no rows (e.g. the default is disabled).
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: CLAIMER_PUBKEY,
      role: 'USER' as any,
      method: 'nip98'
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user1',
      pubkey: CLAIMER_PUBKEY,
      remoteWallets: []
    } as any)
    mockPendingToken()
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 1
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({
      ...claimedCardRow,
      remoteWalletId: null
    } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: {}
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))
    await assertResponse(res, 200)

    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'user1', remoteWalletId: null, kind: 'SIMPLE' }
      })
    )
  })

  it('creates a fresh user on first claim and binds no wallet when none exists', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: CLAIMER_PUBKEY,
      role: 'USER' as any,
      method: 'nip98'
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null as any)
    vi.mocked(createNewUser).mockResolvedValue({
      id: 'user2',
      pubkey: CLAIMER_PUBKEY,
      remoteWallets: []
    } as any)
    mockPendingToken()
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 1
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({
      ...claimedCardRow,
      remoteWalletId: null
    } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: {}
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))
    await assertResponse(res, 200)

    expect(createNewUser).toHaveBeenCalledWith(CLAIMER_PUBKEY)
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'user2', remoteWalletId: null, kind: 'SIMPLE' }
      })
    )
  })

  it('binds an explicitly chosen wallet that belongs to the claimer', async () => {
    mockClaimer('w1')
    mockPendingToken()
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'w2',
      userId: 'user1',
      status: 'ACTIVE'
    } as any)
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 1
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({
      ...claimedCardRow,
      remoteWalletId: 'w2'
    } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: { remoteWalletId: 'w2' }
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))
    await assertResponse(res, 200)

    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'user1', remoteWalletId: 'w2', kind: 'SIMPLE' }
      })
    )
  })

  it('rejects a wallet that does not belong to the claimer (400)', async () => {
    mockClaimer('w1')
    mockPendingToken()
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
      id: 'w2',
      userId: 'someone-else',
      status: 'ACTIVE'
    } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: { remoteWalletId: 'w2' }
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
      status: 'DISABLED'
    } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: { remoteWalletId: 'w2' }
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBe(400)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('returns 409 when the token was already claimed', async () => {
    mockClaimer('w1')
    mockPendingToken({ status: 'CLAIMED' })

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: {}
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBe(409)
  })

  it('returns 409 when a concurrent claim wins the burn race', async () => {
    mockClaimer('w1')
    mockPendingToken()
    // Token read as PENDING, but the scoped burn updates 0 rows.
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 0
    } as any)

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: {}
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBe(409)
    expect(prismaMock.card.update).not.toHaveBeenCalled()
  })

  it('returns 409 for an expired token', async () => {
    mockClaimer('w1')
    mockPendingToken({ expiresAt: new Date(Date.now() - 1000) })

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: {}
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBe(409)
  })

  it('rejects an unauthenticated claim', async () => {
    vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('nope'))

    const req = createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body: {}
    })
    const res = await ClaimToken(req, createParamsPromise({ id: 'tok1' }))

    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  it('mints an LNCurl wallet and binds it when the claimer has none', async () => {
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: CLAIMER_PUBKEY,
      role: 'USER' as any,
      method: 'nip98'
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user1',
      pubkey: CLAIMER_PUBKEY
    } as any)
    vi.mocked(createLncurlRemoteWallet).mockResolvedValueOnce({
      id: 'lncurl-1'
    } as any)
    mockPendingToken()
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 1
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({
      ...claimedCardRow,
      remoteWalletId: 'lncurl-1'
    } as any)

    const res = await ClaimToken(
      createNextRequest('/api/activation-tokens/tok1/claim', {
        method: 'POST',
        body: {}
      }),
      createParamsPromise({ id: 'tok1' })
    )
    const body: any = await assertResponse(res, 200)

    expect(createLncurlRemoteWallet).toHaveBeenCalledWith({ userId: 'user1' })
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'user1',
          remoteWalletId: 'lncurl-1',
          kind: 'SIMPLE'
        }
      })
    )
    expect(body.needsLightningAddress).toBe(true)
    expect(body.bonuses.freeLightningAddress).toBe(true)
    expect(prismaMock.cardActivationBonus.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cardId: 'card1',
          userId: 'user1',
          kind: 'FREE_ADDRESS',
          status: 'RESERVED'
        })
      })
    )
  })

  it('does not grant a free address when the card was already claimed', async () => {
    mockClaimer(null)
    mockPendingToken()
    vi.mocked(prismaMock.cardActivationToken.findFirst).mockResolvedValue({
      id: 'old-claim'
    } as any)
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 1
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({
      ...claimedCardRow,
      remoteWalletId: null
    } as any)

    const res = await ClaimToken(
      createNextRequest('/api/activation-tokens/tok1/claim', {
        method: 'POST',
        body: {}
      }),
      createParamsPromise({ id: 'tok1' })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.bonuses.freeLightningAddress).toBe(false)
    expect(prismaMock.cardActivationBonus.create).not.toHaveBeenCalled()
  })

  it('does not grant a second free address to a user who already used the bonus', async () => {
    mockClaimer(null)
    mockPendingToken()
    vi.mocked(prismaMock.cardActivationBonus.findFirst).mockResolvedValue({
      id: 'prior-grant'
    } as any)
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 1
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue({
      ...claimedCardRow,
      remoteWalletId: null
    } as any)

    const res = await ClaimToken(
      createNextRequest('/api/activation-tokens/tok1/claim', {
        method: 'POST',
        body: {}
      }),
      createParamsPromise({ id: 'tok1' })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.bonuses.freeLightningAddress).toBe(false)
    expect(prismaMock.cardActivationBonus.create).not.toHaveBeenCalled()
  })

  it('pays a sats bonus once and marks the grant redeemed', async () => {
    mockClaimer('w1')
    mockPendingToken()
    vi.mocked(prismaMock.settings.findMany).mockResolvedValue([
      { name: 'card_sats_bonus_enabled', value: 'true' },
      { name: 'card_sats_bonus_amount', value: '210' },
      { name: 'card_sats_bonus_wallet_id', value: 'treasury-1' }
    ] as any)
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValueOnce(
      null
    )
    ;(prismaMock.remoteWallet.findUnique as any).mockImplementation(
      async ({ where }: any) => {
        if (where.id === 'treasury-1' || where.id === 'w1') {
          return { id: where.id, userId: 'admin', status: 'ACTIVE' } as any
        }
        return null
      }
    )
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 1
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue(claimedCardRow as any)
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValueOnce({
      id: 'sats-1',
      status: 'RESERVED',
      amountSats: 210,
      sourceWalletId: 'treasury-1'
    } as any)
    const makeInvoice = vi.fn().mockResolvedValue({ bolt11: 'lnbc1' })
    const payInvoice = vi.fn().mockResolvedValue({ preimage: 'ab', feesPaidSats: 0 })
    vi.mocked(driverForWallet).mockReturnValue({
      driver: { makeInvoice, payInvoice },
      config: {}
    } as any)

    const res = await ClaimToken(
      createNextRequest('/api/activation-tokens/tok1/claim', {
        method: 'POST',
        body: {}
      }),
      createParamsPromise({ id: 'tok1' })
    )
    const body: any = await assertResponse(res, 200)

    expect(prismaMock.cardActivationBonus.upsert).toHaveBeenCalled()
    expect(makeInvoice).toHaveBeenCalled()
    expect(payInvoice).toHaveBeenCalledWith({}, { bolt11: 'lnbc1' })
    expect(prismaMock.cardActivationBonus.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sats-1' },
        data: { status: 'REDEEMED' }
      })
    )
    expect(body.bonuses.sats).toEqual({ granted: true, amountSats: 210 })
  })

  it('leaves a failed sats payment reserved so the card can retry', async () => {
    mockClaimer('w1')
    mockPendingToken()
    vi.mocked(prismaMock.settings.findMany).mockResolvedValue([
      { name: 'card_sats_bonus_enabled', value: 'true' },
      { name: 'card_sats_bonus_amount', value: '210' },
      { name: 'card_sats_bonus_wallet_id', value: 'treasury-1' }
    ] as any)
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValueOnce(
      null
    )
    ;(prismaMock.remoteWallet.findUnique as any).mockImplementation(
      async ({ where }: any) => {
        if (where.id === 'treasury-1' || where.id === 'w1') {
          return { id: where.id, userId: 'admin', status: 'ACTIVE' } as any
        }
        return null
      }
    )
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 1
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue(claimedCardRow as any)
    vi.mocked(prismaMock.cardActivationBonus.findUnique).mockResolvedValueOnce({
      id: 'sats-1',
      status: 'RESERVED',
      amountSats: 210,
      sourceWalletId: 'treasury-1'
    } as any)
    vi.mocked(driverForWallet).mockImplementation(() => {
      throw new Error('treasury empty')
    })

    const res = await ClaimToken(
      createNextRequest('/api/activation-tokens/tok1/claim', {
        method: 'POST',
        body: {}
      }),
      createParamsPromise({ id: 'tok1' })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.bonuses.sats.granted).toBe(false)
    expect(prismaMock.cardActivationBonus.update).not.toHaveBeenCalled()
  })
})
