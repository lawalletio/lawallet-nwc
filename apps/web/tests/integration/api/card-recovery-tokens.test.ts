import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { AuthorizationError } from '@/types/server/errors'

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
  RateLimitPresets: {
    auth: {},
    cardScan: {},
    sensitive: { maxRequests: 5 },
    default: {}
  }
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn()
}))

vi.mock('@/lib/public-url', () => ({
  resolveApiUrl: vi.fn(async () => 'https://test.example')
}))

vi.mock('@/lib/ntag424', () => ({ verifyNtag424FromPC: vi.fn() }))
vi.mock('@/lib/card-payments/attempts', () => ({ claimCardTap: vi.fn() }))

vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))
vi.mock('@/lib/activity-log', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/activity-log')>()),
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() })
}))

// The real minter runs (so qrPayload is built for real); the spy records
// what the route asked for.
vi.mock('@/lib/card-activation', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/card-activation')>()
  return { ...actual, mintActivationToken: vi.fn(actual.mintActivationToken) }
})

import { POST } from '@/app/api/cards/[id]/recovery-tokens/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission, Role } from '@/lib/auth/permissions'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { verifyNtag424FromPC } from '@/lib/ntag424'
import { claimCardTap } from '@/lib/card-payments/attempts'
import {
  RECOVERY_TOKEN_TTL_MS,
  mintActivationToken
} from '@/lib/card-activation'
import { eventBus } from '@/lib/events/event-bus'
import { logActivity } from '@/lib/activity-log'

const OPERATOR_PUBKEY = 'a'.repeat(64)
const OPERATOR_ID = 'operator-1'
const OWNER_ID = 'owner-1'
const CID = '04a1b2c3d4e5f6'
const NTAG = { cid: CID, k1: 'k1-secret', k2: 'k2-secret', ctr: 41 }
// Lower-case on the wire: the route upper-cases before verifying.
const P = 'abcdef0123456789abcdef0123456789'
const C = '0123456789abcdef'

function mockOperator() {
  vi.mocked(authenticateWithPermission).mockResolvedValue({
    pubkey: OPERATOR_PUBKEY,
    role: Role.OPERATOR,
    method: 'jwt'
  })
  vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
    user: { id: OPERATOR_ID, pubkey: OPERATOR_PUBKEY, role: 'OPERATOR' }
  } as any)
}

function seedCard(overrides: Record<string, unknown> = {}) {
  vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
    id: 'card1',
    userId: OWNER_ID,
    blockedAt: null,
    disabledAt: null,
    ntag424Cid: CID,
    ntag424: NTAG,
    user: { cardRecoveryEnabled: true },
    ...overrides
  } as any)
}

function seedGoodTap(ctrNew = 42) {
  vi.mocked(verifyNtag424FromPC).mockResolvedValue({
    ok: NTAG,
    ctrNew
  } as any)
  vi.mocked(claimCardTap).mockResolvedValue(true)
}

function post(body: Record<string, unknown> = { p: P, c: C }, id = 'card1') {
  return POST(
    createNextRequest(`/api/cards/${id}/recovery-tokens`, {
      method: 'POST',
      body
    }),
    createParamsPromise({ id })
  )
}

/** Nothing was minted, revoked or announced. */
function expectNothingMinted() {
  expect(mintActivationToken).not.toHaveBeenCalled()
  expect(prismaMock.cardActivationToken.updateMany).not.toHaveBeenCalled()
  expect(prismaMock.cardActivationToken.create).not.toHaveBeenCalled()
  expect(eventBus.emit).not.toHaveBeenCalled()
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
    count: 0
  } as any)
  vi.mocked(prismaMock.cardActivationToken.create).mockImplementation(
    (async (args: any) => args.data) as any
  )
})

describe('POST /api/cards/[id]/recovery-tokens', () => {
  it('mints a 15-minute RECOVER QR from a fresh tap (201)', async () => {
    mockOperator()
    seedCard()
    seedGoodTap()

    const before = Date.now()
    const res = await post()
    const after = Date.now()
    const body: any = await assertResponse(res, 201)

    expect(body.purpose).toBe('RECOVER')
    expect(body.qrKind).toBe('ONE_TIME')
    expect(body.tokenId).toMatch(/^[0-9a-f]{32}$/)
    expect(body.qrPayload).toBe(
      `https://test.example/wallet/activate/${body.tokenId}?tag=recover`
    )
    expect(body.qrPayload.endsWith('?tag=recover')).toBe(true)
    const expiresAt = new Date(body.expiresAt).getTime()
    expect(expiresAt).toBeGreaterThanOrEqual(before + RECOVERY_TOKEN_TTL_MS)
    expect(expiresAt).toBeLessThanOrEqual(after + RECOVERY_TOKEN_TTL_MS)
    // No NTAG keys leak.
    expect(JSON.stringify(body)).not.toContain('secret')
  })

  it('asks the minter for a RECOVER token for the card holder', async () => {
    mockOperator()
    seedCard()
    seedGoodTap()

    const before = Date.now()
    await assertResponse(await post(), 201)
    const after = Date.now()

    expect(mintActivationToken).toHaveBeenCalledTimes(1)
    const [tx, args] = vi.mocked(mintActivationToken).mock.calls[0]
    expect(tx).toBe(prismaMock)
    expect(args).toEqual({
      cardId: 'card1',
      qrKind: 'ONE_TIME',
      purpose: 'RECOVER',
      recoverFromUserId: OWNER_ID,
      baseUrl: 'https://test.example',
      issuedByUserId: OPERATOR_ID,
      expiresAt: expect.any(Date)
    })
    const expiry = args.expiresAt!.getTime()
    expect(expiry).toBeGreaterThanOrEqual(before + RECOVERY_TOKEN_TTL_MS)
    expect(expiry).toBeLessThanOrEqual(after + RECOVERY_TOKEN_TTL_MS)
    // Stored with the owner on the row itself.
    expect(prismaMock.cardActivationToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: 'RECOVER',
        recoverFromUserId: OWNER_ID
      })
    })
  })

  it('upper-cases p and c before verifying, then burns the tap counter', async () => {
    mockOperator()
    seedCard()
    seedGoodTap(42)

    await assertResponse(await post(), 201)

    expect(verifyNtag424FromPC).toHaveBeenCalledWith(
      NTAG,
      P.toUpperCase(),
      C.toUpperCase()
    )
    expect(claimCardTap).toHaveBeenCalledWith('card1', CID, 42)
    // Verified and burned before anything is minted.
    expect(vi.mocked(claimCardTap).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mintActivationToken).mock.invocationCallOrder[0]
    )
  })

  it('announces the card update and logs the issue', async () => {
    mockOperator()
    seedCard()
    seedGoodTap()

    const body: any = await assertResponse(await post(), 201)

    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cards:updated' })
    )
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'CARD',
        event: 'card.recovery_token_issued',
        level: 'WARN',
        userId: OPERATOR_ID,
        metadata: {
          cardId: 'card1',
          tokenId: body.tokenId,
          ownerUserId: OWNER_ID
        }
      })
    )
  })

  it('records no issuer when the operator has no account row', async () => {
    mockOperator()
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
    seedCard()
    seedGoodTap()

    await assertResponse(await post(), 201)

    expect(vi.mocked(mintActivationToken).mock.calls[0][1].issuedByUserId).toBe(
      null
    )
  })

  it('rate-limits per operator with the sensitive preset', async () => {
    mockOperator()
    seedCard()
    seedGoodTap()

    await post()

    expect(rateLimit).toHaveBeenCalledWith(expect.anything(), {
      maxRequests: 5,
      identifier: `card-recovery:${OPERATOR_PUBKEY}`
    })
  })

  it('requires CARDS_WRITE', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(
      new AuthorizationError('Not authorized')
    )

    const res = await post()

    expect(res.status).toBe(403)
    expect(authenticateWithPermission).toHaveBeenCalledWith(
      expect.anything(),
      Permission.CARDS_WRITE
    )
    expect(prismaMock.card.findUnique).not.toHaveBeenCalled()
    expectNothingMinted()
  })

  it.each([
    ['p', { c: C }],
    ['c', { p: P }]
  ])('400s when %s is missing', async (_field, body) => {
    mockOperator()

    const res = await post(body)

    expect(res.status).toBe(400)
    expect(verifyNtag424FromPC).not.toHaveBeenCalled()
    expectNothingMinted()
  })

  it('404s for an unknown card', async () => {
    mockOperator()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const res = await post({ p: P, c: C }, 'missing')

    expect(res.status).toBe(404)
    expectNothingMinted()
  })

  it.each([
    ['has no owner', { userId: null, user: null }, 409, /no owner/],
    ['is blocked', { blockedAt: new Date() }, 409, /blocked/],
    ['is paused by its owner', { disabledAt: new Date() }, 409, /paused/],
    [
      'belongs to an owner who turned recovery off',
      { user: { cardRecoveryEnabled: false } },
      403,
      /turned off card recovery/
    ],
    ['is not paired', { ntag424: null, ntag424Cid: null }, 409, /not paired/]
  ])(
    'refuses a card that %s before checking the tap',
    async (_label, card, status, message) => {
      mockOperator()
      seedCard(card)
      seedGoodTap()

      const res = await post()
      const body: any = await res.json()

      expect(res.status).toBe(status)
      expect(body.error.message).toMatch(message)
      expect(verifyNtag424FromPC).not.toHaveBeenCalled()
      expect(claimCardTap).not.toHaveBeenCalled()
      expectNothingMinted()
    }
  )

  it('400s on a SUN verification failure without burning the counter', async () => {
    mockOperator()
    seedCard()
    vi.mocked(verifyNtag424FromPC).mockResolvedValue({
      error: 'MALFORMED_C__SDMMAC_MISMATCH'
    } as any)

    const res = await post()

    expect(res.status).toBe(400)
    expect(claimCardTap).not.toHaveBeenCalled()
    expectNothingMinted()
  })

  it('409s on a replayed tap', async () => {
    mockOperator()
    seedCard()
    vi.mocked(verifyNtag424FromPC).mockResolvedValue({
      ok: NTAG,
      ctrNew: 41
    } as any)
    vi.mocked(claimCardTap).mockResolvedValue(false)

    const res = await post()
    const body: any = await res.json()

    expect(res.status).toBe(409)
    expect(body.error.message).toMatch(/already used/)
    expectNothingMinted()
  })

  it('409s when a concurrent mint wins the unique index', async () => {
    mockOperator()
    seedCard()
    seedGoodTap()
    vi.mocked(prismaMock.cardActivationToken.create).mockRejectedValue({
      code: 'P2002'
    })

    const res = await post()

    expect(res.status).toBe(409)
    expect(eventBus.emit).not.toHaveBeenCalled()
  })

  it('surfaces any other mint failure as a 500', async () => {
    mockOperator()
    seedCard()
    seedGoodTap()
    vi.mocked(prismaMock.cardActivationToken.create).mockRejectedValue(
      new Error('db down')
    )

    const res = await post()

    expect(res.status).toBe(500)
    expect(eventBus.emit).not.toHaveBeenCalled()
  })
})
