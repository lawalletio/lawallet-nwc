import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError
} from '@/types/server/errors'

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
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn() }))
vi.mock('@/lib/wallet/lncurl-wallet', () => ({
  createLncurlRemoteWallet: vi.fn().mockRejectedValue(new Error('lncurl off'))
}))
vi.mock('@/lib/wallet/drivers', () => ({ driverForWallet: vi.fn() }))

vi.mock('@/lib/account/recover', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/account/recover')>()),
  getRecoveryCheck: vi.fn(),
  recoverAccountViaCard: vi.fn(),
  assertRecoveryClaimable: vi.fn()
}))

import { GET as RecoveryCheck } from '@/app/api/activation-tokens/[id]/recovery-check/route'
import { POST as ClaimToken } from '@/app/api/activation-tokens/[id]/claim/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { createNewUser } from '@/lib/user'
import { getSettings } from '@/lib/settings'
import { createLncurlRemoteWallet } from '@/lib/wallet/lncurl-wallet'
import {
  RECOVERY_MERGE_REQUIRED,
  assertRecoveryClaimable,
  getRecoveryCheck,
  recoverAccountViaCard
} from '@/lib/account/recover'

const CLAIMER_PUBKEY = 'b'.repeat(64)
const CLAIMER_ID = 'claimer-1'

function mockAuth() {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: CLAIMER_PUBKEY,
    role: 'USER' as any,
    method: 'nip98'
  })
}

/** The pubkey resolves to an existing account. */
function mockExistingClaimer() {
  mockAuth()
  vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
    user: { id: CLAIMER_ID, pubkey: CLAIMER_PUBKEY, role: 'USER' }
  } as any)
}

/** The pubkey has no account yet. */
function mockNewPubkey() {
  mockAuth()
  vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue(null)
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
  vi.mocked(createNewUser).mockResolvedValue({
    id: 'new-user',
    pubkey: CLAIMER_PUBKEY
  } as any)
}

function mockToken(overrides: Record<string, unknown> = {}) {
  vi.mocked(prismaMock.cardActivationToken.findUnique).mockResolvedValue({
    id: 'tok1',
    cardId: 'card1',
    qrKind: 'ONE_TIME',
    purpose: 'RECOVER',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 60_000),
    card: { blockedAt: null },
    ...overrides
  } as any)
}

const SUMMARY = {
  lightningAddresses: ['alice', 'alice2'],
  primaryAddress: 'alice',
  cards: [{ id: 'card1', title: 'Blue card', designImageUrl: 'https://img' }],
  remoteWallets: [{ id: 'w1', name: 'Main', isDefault: true }],
  vouchers: 3,
  recoveredWith: { cardId: 'card1', title: 'Blue card' }
}

function mockRecovered(overrides: Record<string, unknown> = {}) {
  vi.mocked(recoverAccountViaCard).mockResolvedValue({
    outcome: 'recovered',
    cardId: 'card1',
    recoveryId: 'recovery-1',
    fromUserId: 'old-owner',
    mergedIntoExisting: false,
    summary: SUMMARY,
    ...overrides
  } as any)
}

function claim(body: Record<string, unknown> = {}) {
  return ClaimToken(
    createNextRequest('/api/activation-tokens/tok1/claim', {
      method: 'POST',
      body
    }),
    createParamsPromise({ id: 'tok1' })
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(getSettings).mockResolvedValue({ domain: 'lawallet.test' })
})

// ── recovery-check ──────────────────────────────────────────────────────────

describe('GET /api/activation-tokens/[id]/recovery-check', () => {
  function check(id = 'tok1') {
    return RecoveryCheck(
      createNextRequest(`/api/activation-tokens/${id}/recovery-check`),
      createParamsPromise({ id })
    )
  }

  it('renders both sides with full user@domain addresses', async () => {
    mockExistingClaimer()
    vi.mocked(getRecoveryCheck).mockResolvedValue({
      sameAccount: false,
      mergeRequired: true,
      existing: { lightningAddresses: ['bob'], cards: 1, remoteWallets: 2 },
      incoming: {
        lightningAddresses: ['alice', 'alice2'],
        cards: 3,
        remoteWallets: 1
      }
    })

    const body = await assertResponse(await check(), 200)

    expect(getRecoveryCheck).toHaveBeenCalledWith({
      tokenId: 'tok1',
      claimerId: CLAIMER_ID
    })
    expect(body).toEqual({
      sameAccount: false,
      mergeRequired: true,
      existing: {
        lightningAddresses: ['bob@lawallet.test'],
        cards: 1,
        remoteWallets: 2
      },
      incoming: {
        lightningAddresses: ['alice@lawallet.test', 'alice2@lawallet.test'],
        cards: 3,
        remoteWallets: 1
      }
    })
  })

  it('passes a null claimer for a pubkey with no account and creates none', async () => {
    mockAuth()
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
    vi.mocked(getRecoveryCheck).mockResolvedValue({
      sameAccount: false,
      mergeRequired: false,
      existing: { lightningAddresses: [], cards: 0, remoteWallets: 0 },
      incoming: { lightningAddresses: ['alice'], cards: 1, remoteWallets: 1 }
    })

    const body: any = await assertResponse(await check(), 200)

    expect(getRecoveryCheck).toHaveBeenCalledWith({
      tokenId: 'tok1',
      claimerId: null
    })
    expect(createNewUser).not.toHaveBeenCalled()
    expect(body.existing.lightningAddresses).toEqual([])
    expect(body.incoming.lightningAddresses).toEqual(['alice@lawallet.test'])
  })

  it('reports the same account', async () => {
    mockExistingClaimer()
    vi.mocked(getRecoveryCheck).mockResolvedValue({
      sameAccount: true,
      mergeRequired: false,
      existing: { lightningAddresses: ['alice'], cards: 1, remoteWallets: 1 },
      incoming: { lightningAddresses: ['alice'], cards: 1, remoteWallets: 1 }
    })

    const body: any = await assertResponse(await check(), 200)

    expect(body.sameAccount).toBe(true)
    expect(body.mergeRequired).toBe(false)
  })

  it('404s for a non-RECOVER token', async () => {
    mockExistingClaimer()
    vi.mocked(getRecoveryCheck).mockRejectedValue(
      new NotFoundError('Recovery token not found')
    )

    const res = await check()

    expect(res.status).toBe(404)
  })

  it('409s for a claimed or expired token', async () => {
    mockExistingClaimer()
    vi.mocked(getRecoveryCheck).mockRejectedValue(
      new ConflictError('Recovery QR has expired')
    )

    const res = await check()

    expect(res.status).toBe(409)
  })

  it('401s without authentication', async () => {
    vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('no'))

    const res = await check()

    expect(res.status).toBe(401)
    expect(getRecoveryCheck).not.toHaveBeenCalled()
  })
})

// ── claim: RECOVER branch ───────────────────────────────────────────────────

describe('POST /api/activation-tokens/[id]/claim (RECOVER)', () => {
  it('creates a new pubkey without a courtesy wallet before recovering', async () => {
    mockNewPubkey()
    mockToken()
    mockRecovered()

    await assertResponse(await claim(), 200)

    expect(createNewUser).toHaveBeenCalledTimes(1)
    expect(createNewUser).toHaveBeenCalledWith(CLAIMER_PUBKEY, {
      skipCourtesyWallet: true
    })
    expect(recoverAccountViaCard).toHaveBeenCalledWith({
      tokenId: 'tok1',
      claimerId: 'new-user',
      confirmMerge: undefined
    })
  })

  it('refuses before creating an account when the recovery cannot go through', async () => {
    mockNewPubkey()
    mockToken()
    vi.mocked(assertRecoveryClaimable).mockRejectedValueOnce(
      new AuthorizationError('The owner turned off card recovery')
    )

    const res = await claim()

    expect(res.status).toBe(403)
    expect(createNewUser).not.toHaveBeenCalled()
    expect(recoverAccountViaCard).not.toHaveBeenCalled()
  })

  it('skips the pre-check for an existing claimer (the transaction re-checks)', async () => {
    mockExistingClaimer()
    mockToken()
    mockRecovered()

    await assertResponse(await claim(), 200)

    expect(assertRecoveryClaimable).not.toHaveBeenCalled()
  })

  it('recovers into an existing account without creating one', async () => {
    mockExistingClaimer()
    mockToken()
    mockRecovered()

    await assertResponse(await claim(), 200)

    expect(createNewUser).not.toHaveBeenCalled()
    expect(recoverAccountViaCard).toHaveBeenCalledWith(
      expect.objectContaining({ claimerId: CLAIMER_ID })
    )
  })

  it('passes confirmMerge through', async () => {
    mockExistingClaimer()
    mockToken()
    mockRecovered({ mergedIntoExisting: true })

    const body: any = await assertResponse(
      await claim({ confirmMerge: true }),
      200
    )

    expect(recoverAccountViaCard).toHaveBeenCalledWith({
      tokenId: 'tok1',
      claimerId: CLAIMER_ID,
      confirmMerge: true
    })
    expect(body.recovery.mergedIntoExisting).toBe(true)
  })

  it('rejects a non-boolean confirmMerge (400)', async () => {
    mockExistingClaimer()
    mockToken()

    const res = await claim({ confirmMerge: 'yes' })

    expect(res.status).toBe(400)
    expect(recoverAccountViaCard).not.toHaveBeenCalled()
  })

  it('answers same-account when the owner scans their own QR', async () => {
    mockExistingClaimer()
    mockToken()
    vi.mocked(recoverAccountViaCard).mockResolvedValue({
      outcome: 'same-account',
      cardId: 'card1'
    })

    const body = await assertResponse(await claim(), 200)

    expect(body).toEqual({
      qrKind: 'ONE_TIME',
      purpose: 'RECOVER',
      outcome: 'same-account'
    })
    expect(prismaMock.lightningAddress.count).not.toHaveBeenCalled()
  })

  it('returns the recovered summary with full addresses', async () => {
    mockExistingClaimer()
    mockToken()
    mockRecovered()
    vi.mocked(prismaMock.lightningAddress.count).mockResolvedValue(2)

    const body = await assertResponse(await claim(), 200)

    expect(body).toEqual({
      qrKind: 'ONE_TIME',
      purpose: 'RECOVER',
      outcome: 'recovered',
      recovery: {
        lightningAddresses: ['alice@lawallet.test', 'alice2@lawallet.test'],
        primaryAddress: 'alice@lawallet.test',
        cards: SUMMARY.cards,
        remoteWallets: SUMMARY.remoteWallets,
        vouchers: 3,
        mergedIntoExisting: false
      },
      needsLightningAddress: false
    })
    expect(prismaMock.lightningAddress.count).toHaveBeenCalledWith({
      where: { userId: CLAIMER_ID }
    })
  })

  it('asks for a lightning address when the recovered account had none', async () => {
    mockNewPubkey()
    mockToken()
    mockRecovered({
      summary: { ...SUMMARY, lightningAddresses: [], primaryAddress: null }
    })
    vi.mocked(prismaMock.lightningAddress.count).mockResolvedValue(0)

    const body: any = await assertResponse(await claim(), 200)

    expect(body.recovery.lightningAddresses).toEqual([])
    expect(body.recovery.primaryAddress).toBeNull()
    expect(body.needsLightningAddress).toBe(true)
  })

  it('surfaces RECOVERY_MERGE_REQUIRED as a 409 with the reason', async () => {
    mockExistingClaimer()
    mockToken()
    vi.mocked(recoverAccountViaCard).mockRejectedValue(
      new ConflictError('This account already has data.', {
        reason: RECOVERY_MERGE_REQUIRED
      })
    )

    const res = await claim()
    const body: any = await res.json()

    expect(res.status).toBe(409)
    expect(body.error.details).toEqual({ reason: 'RECOVERY_MERGE_REQUIRED' })
  })

  it('skips the activation work: no card transfer, wallet binding or bonus', async () => {
    mockNewPubkey()
    mockToken()
    mockRecovered()
    vi.mocked(prismaMock.lightningAddress.count).mockResolvedValue(2)

    await assertResponse(await claim({ remoteWalletId: 'w-other' }), 200)

    expect(prismaMock.card.update).not.toHaveBeenCalled()
    expect(prismaMock.cardActivationToken.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.remoteWallet.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.cardActivationBonus.create).not.toHaveBeenCalled()
    expect(createLncurlRemoteWallet).not.toHaveBeenCalled()
  })

  it('404s for an unknown token before touching accounts', async () => {
    mockNewPubkey()
    vi.mocked(prismaMock.cardActivationToken.findUnique).mockResolvedValue(null)

    const res = await claim()

    expect(res.status).toBe(404)
    expect(createNewUser).not.toHaveBeenCalled()
    expect(recoverAccountViaCard).not.toHaveBeenCalled()
  })
})

// ── claim: ONE_TIME activation is unaffected ────────────────────────────────

describe('POST /api/activation-tokens/[id]/claim (ACTIVATE)', () => {
  const claimedCard = {
    id: 'card1',
    createdAt: new Date(),
    title: 'My Card',
    lastUsedAt: null,
    username: null,
    remoteWalletId: null,
    kind: 'SIMPLE',
    design: {
      id: 'd1',
      imageUrl: 'https://img',
      description: 'Blue',
      createdAt: new Date()
    },
    user: { pubkey: CLAIMER_PUBKEY }
  }

  it('creates a new user the usual way and transfers the card', async () => {
    mockNewPubkey()
    mockToken({ purpose: 'ACTIVATE' })
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 1
    } as any)
    vi.mocked(prismaMock.card.update).mockResolvedValue(claimedCard as any)

    const body: any = await assertResponse(await claim(), 200)

    // Single argument: the courtesy wallet is still minted on activation.
    expect(vi.mocked(createNewUser).mock.calls).toEqual([[CLAIMER_PUBKEY]])
    expect(recoverAccountViaCard).not.toHaveBeenCalled()
    expect(prismaMock.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card1' },
        data: expect.objectContaining({ userId: 'new-user', kind: 'SIMPLE' })
      })
    )
    expect(body.qrKind).toBe('ONE_TIME')
    expect(body.card.id).toBe('card1')
    expect(body).toHaveProperty('bonuses')
    expect(body).not.toHaveProperty('purpose')
    expect(body).not.toHaveProperty('outcome')
  })

  it('still refuses a blocked card', async () => {
    mockExistingClaimer()
    mockToken({ purpose: 'ACTIVATE', card: { blockedAt: new Date() } })

    const res = await claim()

    expect(res.status).toBe(409)
    expect(recoverAccountViaCard).not.toHaveBeenCalled()
    expect(prismaMock.cardActivationToken.updateMany).not.toHaveBeenCalled()
  })
})
