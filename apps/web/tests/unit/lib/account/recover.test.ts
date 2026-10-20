import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { secret: 'a'.repeat(48), enabled: true },
    isDevelopment: false,
    isTest: true
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: vi.fn(() => undefined)
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    ACCOUNT_RECOVERED: 'user.account_recovered',
    ACCOUNT_TRANSFERRED_OUT: 'user.account_transferred_out',
    CARD_RECOVERY_SETTING_CHANGED: 'user.card_recovery_setting_changed'
  },
  logActivity: { fireAndForget: vi.fn() }
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

// reparent.test.ts covers the move itself; here we assert what recovery
// hands it.
const reparentMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/account/reparent', () => ({
  reparentAccountResources: reparentMock
}))

import {
  RECOVERY_MERGE_REQUIRED,
  accountHasData,
  assertRecoveryClaimable,
  dismissAccountTransferNotices,
  getAccountTransferNotice,
  getRecoveryCheck,
  recoverAccountViaCard,
  setCardRecoveryEnabled
} from '@/lib/account/recover'
import { logActivity } from '@/lib/activity-log'
import { eventBus } from '@/lib/events/event-bus'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError
} from '@/types/server/errors'

const FROM = 'user-old-owner'
const CLAIMER = 'user-claimer'
const TOKEN = 'tok-recover'
const CARD = 'card-recovered'

interface FakeAccount {
  id: string
  pubkey: string
  relays: string | null
  relaysUpdatedAt: Date | null
  currencyPrefs: unknown
  allowVouchers: boolean
  voucherDepositPolicy: 'ANYONE' | 'ALLOWLIST'
  voucherSenderAllowlist: string[]
  cardRecoveryEnabled: boolean
  /** Primary first, as the DB orderBy would return them. */
  addresses: { username: string; isPrimary: boolean }[]
  cards: {
    id: string
    title: string | null
    design: { imageUrl: string } | null
  }[]
  /** Default first, as the DB orderBy would return them. */
  wallets: {
    id: string
    name: string
    isDefault: boolean
    status: 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'DEAD'
    config: unknown
  }[]
  vouchers: number
}

function emptyAccount(id: string): FakeAccount {
  return {
    id,
    pubkey: id.padEnd(64, '0'),
    relays: null,
    relaysUpdatedAt: null,
    currencyPrefs: null,
    allowVouchers: false,
    voucherDepositPolicy: 'ANYONE',
    voucherSenderAllowlist: [],
    cardRecoveryEnabled: true,
    addresses: [],
    cards: [],
    wallets: [],
    vouchers: 0
  }
}

const RELAYS_UPDATED_AT = new Date('2026-09-01T00:00:00.000Z')

/** The card holder whose account is being recovered. */
function oldOwner(overrides: Partial<FakeAccount> = {}): FakeAccount {
  return {
    ...emptyAccount(FROM),
    relays: JSON.stringify(['wss://old.example', 'wss://shared.example']),
    relaysUpdatedAt: RELAYS_UPDATED_AT,
    currencyPrefs: { active: ['SAT', 'USD'], selected: 'USD' },
    allowVouchers: true,
    voucherDepositPolicy: 'ALLOWLIST',
    voucherSenderAllowlist: ['f'.repeat(64)],
    addresses: [
      { username: 'alice', isPrimary: true },
      { username: 'alice2', isPrimary: false }
    ],
    cards: [
      { id: CARD, title: 'Blue card', design: { imageUrl: 'https://img/1' } },
      { id: 'card-other', title: null, design: null }
    ],
    wallets: [
      {
        id: 'w-main',
        name: 'Main',
        isDefault: true,
        status: 'ACTIVE',
        config: { connectionString: 'nostr+walletconnect://main' }
      },
      {
        id: 'w-dead',
        name: 'Old',
        isDefault: false,
        status: 'DEAD',
        config: { provider: 'lncurl' }
      }
    ],
    vouchers: 2,
    ...overrides
  }
}

const LNCURL_WALLET = {
  id: 'w-courtesy',
  name: 'LNCurl wallet',
  isDefault: true,
  status: 'ACTIVE' as const,
  config: { provider: 'lncurl', connectionString: 'nostr+walletconnect://c' }
}

/** A freshly signed-up claimer: only the courtesy LNCurl wallet. */
function freshClaimer(overrides: Partial<FakeAccount> = {}): FakeAccount {
  return { ...emptyAccount(CLAIMER), wallets: [LNCURL_WALLET], ...overrides }
}

/**
 * Backs the per-user reads recover.ts makes (counts, lists, the account
 * rows) with an in-memory map, honoring the live-wallet status filter.
 */
function seedAccounts(...accounts: FakeAccount[]) {
  const byId = new Map(accounts.map(a => [a.id, a]))
  const get = (userId: string) => byId.get(userId) ?? emptyAccount(userId)
  const liveWallets = (where: any) => {
    const notIn: string[] = where?.status?.notIn ?? []
    return get(where.userId).wallets.filter(w => !notIn.includes(w.status))
  }

  vi.mocked(prismaMock.lightningAddress.findMany).mockImplementation(((
    args: any
  ) => Promise.resolve(get(args.where.userId).addresses)) as any)
  vi.mocked(prismaMock.lightningAddress.count).mockImplementation(((
    args: any
  ) => Promise.resolve(get(args.where.userId).addresses.length)) as any)
  vi.mocked(prismaMock.card.count).mockImplementation(((args: any) =>
    Promise.resolve(get(args.where.userId).cards.length)) as any)
  vi.mocked(prismaMock.card.findMany).mockImplementation(((args: any) =>
    Promise.resolve(get(args.where.userId).cards)) as any)
  vi.mocked(prismaMock.voucher.count).mockImplementation(((args: any) =>
    Promise.resolve(get(args.where.userId).vouchers)) as any)
  vi.mocked(prismaMock.remoteWallet.count).mockImplementation(((args: any) =>
    Promise.resolve(liveWallets(args.where).length)) as any)
  vi.mocked(prismaMock.remoteWallet.findMany).mockImplementation(((args: any) =>
    Promise.resolve(
      liveWallets(args.where).map(w =>
        args.select?.config
          ? { config: w.config }
          : { id: w.id, name: w.name, isDefault: w.isDefault }
      )
    )) as any)
  vi.mocked(prismaMock.user.findUnique).mockImplementation(((args: any) => {
    const a = byId.get(args.where.id)
    if (!a) return Promise.resolve(null)
    return Promise.resolve({
      id: a.id,
      pubkey: a.pubkey,
      relays: a.relays,
      relaysUpdatedAt: a.relaysUpdatedAt,
      currencyPrefs: a.currencyPrefs,
      allowVouchers: a.allowVouchers,
      voucherDepositPolicy: a.voucherDepositPolicy,
      voucherSenderAllowlist: a.voucherSenderAllowlist,
      cardRecoveryEnabled: a.cardRecoveryEnabled,
      lightningAddresses: a.addresses.map(x => ({ isPrimary: x.isPrimary })),
      remoteWallets: a.wallets.map(w => ({
        id: w.id,
        name: w.name,
        isDefault: w.isDefault
      }))
    })
  }) as any)
}

function seedToken(overrides: Record<string, unknown> = {}) {
  vi.mocked(prismaMock.cardActivationToken.findUnique).mockResolvedValue({
    id: TOKEN,
    cardId: CARD,
    purpose: 'RECOVER',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    recoverFromUserId: FROM,
    ...overrides
  } as any)
}

function seedCard(overrides: Record<string, unknown> = {}) {
  vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
    userId: FROM,
    title: 'Blue card',
    blockedAt: null,
    disabledAt: null,
    ...overrides
  } as any)
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  reparentMock.mockReset()
  reparentMock.mockResolvedValue({ movedAddresses: 2, movedWallets: 2 })
  vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
    count: 1
  } as any)
  vi.mocked(prismaMock.oAuthGrant.updateMany).mockResolvedValue({
    count: 1
  } as any)
  vi.mocked(prismaMock.user.update).mockResolvedValue({} as any)
  vi.mocked(prismaMock.accountRecovery.create).mockResolvedValue({
    id: 'recovery-1'
  } as any)
})

// ── assertRecoveryClaimable ─────────────────────────────────────────────────

describe('assertRecoveryClaimable', () => {
  const ownerAllows = (cardRecoveryEnabled = true) => ({
    user: { cardRecoveryEnabled }
  })

  it('passes for a pending token on a card the minting-time owner still holds', async () => {
    seedToken()
    seedCard(ownerAllows())

    await expect(assertRecoveryClaimable(TOKEN)).resolves.toBeUndefined()
  })

  it('rejects a non-RECOVER token as not found', async () => {
    seedToken({ purpose: 'ACTIVATE' })

    await expect(assertRecoveryClaimable(TOKEN)).rejects.toBeInstanceOf(
      NotFoundError
    )
  })

  it('rejects an expired token', async () => {
    seedToken({ expiresAt: new Date(Date.now() - 1000) })

    await expect(assertRecoveryClaimable(TOKEN)).rejects.toBeInstanceOf(
      ConflictError
    )
  })

  it.each([
    ['the card changed hands', { userId: 'someone-else', ...ownerAllows() }],
    ['the card is blocked', { blockedAt: new Date(), ...ownerAllows() }],
    ['the card is paused', { disabledAt: new Date(), ...ownerAllows() }]
  ])('409s when %s', async (_label, card) => {
    seedToken()
    seedCard(card)

    await expect(assertRecoveryClaimable(TOKEN)).rejects.toBeInstanceOf(
      ConflictError
    )
  })

  it('403s when the owner turned card recovery off', async () => {
    seedToken()
    seedCard(ownerAllows(false))

    await expect(assertRecoveryClaimable(TOKEN)).rejects.toBeInstanceOf(
      AuthorizationError
    )
  })

  it('writes nothing', async () => {
    seedToken()
    seedCard(ownerAllows())

    await assertRecoveryClaimable(TOKEN)

    expect(prismaMock.cardActivationToken.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })
})

// ── getRecoveryCheck ────────────────────────────────────────────────────────

describe('getRecoveryCheck', () => {
  it('reads the token by id with the recovery select', async () => {
    seedToken()
    seedAccounts(oldOwner(), freshClaimer())

    await getRecoveryCheck({ tokenId: TOKEN, claimerId: CLAIMER })

    expect(prismaMock.cardActivationToken.findUnique).toHaveBeenCalledWith({
      where: { id: TOKEN },
      select: expect.objectContaining({
        purpose: true,
        status: true,
        expiresAt: true,
        recoverFromUserId: true
      })
    })
  })

  it.each([
    ['a missing token', null],
    ['an ACTIVATE token', { purpose: 'ACTIVATE' }],
    ['a RECOVER token without an owner', { recoverFromUserId: null }]
  ])('404s for %s', async (_label, token) => {
    if (token === null) {
      vi.mocked(prismaMock.cardActivationToken.findUnique).mockResolvedValue(
        null
      )
    } else {
      seedToken(token)
    }

    await expect(
      getRecoveryCheck({ tokenId: TOKEN, claimerId: CLAIMER })
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it.each([
    ['claimed', { status: 'CLAIMED' }],
    ['revoked', { status: 'REVOKED' }],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }]
  ])('409s for a %s token', async (_label, overrides) => {
    seedToken(overrides)

    await expect(
      getRecoveryCheck({ tokenId: TOKEN, claimerId: CLAIMER })
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('accepts a RECOVER token without an expiry', async () => {
    seedToken({ expiresAt: null })
    seedAccounts(oldOwner(), freshClaimer())

    const check = await getRecoveryCheck({ tokenId: TOKEN, claimerId: CLAIMER })
    expect(check.sameAccount).toBe(false)
  })

  it('flags the same account and never asks to merge', async () => {
    seedToken()
    seedAccounts(oldOwner())

    const check = await getRecoveryCheck({ tokenId: TOKEN, claimerId: FROM })

    expect(check.sameAccount).toBe(true)
    expect(check.mergeRequired).toBe(false)
    // accountHasData is skipped: it is the only caller of voucher.count.
    expect(prismaMock.voucher.count).not.toHaveBeenCalled()
  })

  it('summarizes both sides (live wallets only)', async () => {
    seedToken()
    seedAccounts(oldOwner(), freshClaimer())

    const check = await getRecoveryCheck({ tokenId: TOKEN, claimerId: CLAIMER })

    expect(check).toEqual({
      sameAccount: false,
      mergeRequired: false,
      existing: { lightningAddresses: [], cards: 0, remoteWallets: 1 },
      incoming: {
        lightningAddresses: ['alice', 'alice2'],
        cards: 2,
        // w-dead is excluded by the live-wallet filter.
        remoteWallets: 1
      }
    })
    expect(prismaMock.remoteWallet.count).toHaveBeenCalledWith({
      where: { userId: FROM, status: { notIn: ['REVOKED', 'DEAD'] } }
    })
  })

  it.each([
    [
      'a lightning address',
      { addresses: [{ username: 'bob', isPrimary: true }] }
    ],
    ['a card', { cards: [{ id: 'card-bob', title: null, design: null }] }],
    ['a voucher', { vouchers: 1 }],
    [
      'a non-LNCurl wallet',
      {
        wallets: [
          LNCURL_WALLET,
          {
            id: 'w-own',
            name: 'My NWC',
            isDefault: false,
            status: 'ACTIVE' as const,
            config: { connectionString: 'nostr+walletconnect://own' }
          }
        ]
      }
    ]
  ])('requires a merge when the claimer has %s', async (_label, data) => {
    seedToken()
    seedAccounts(oldOwner(), freshClaimer(data))

    const check = await getRecoveryCheck({ tokenId: TOKEN, claimerId: CLAIMER })
    expect(check.mergeRequired).toBe(true)
  })

  it('does not require a merge when the claimer only has an LNCurl wallet', async () => {
    seedToken()
    seedAccounts(oldOwner(), freshClaimer())

    const check = await getRecoveryCheck({ tokenId: TOKEN, claimerId: CLAIMER })
    expect(check.mergeRequired).toBe(false)
  })

  it('ignores a dead non-LNCurl wallet when deciding on a merge', async () => {
    seedToken()
    seedAccounts(
      oldOwner(),
      freshClaimer({
        wallets: [
          LNCURL_WALLET,
          {
            id: 'w-gone',
            name: 'Revoked NWC',
            isDefault: false,
            status: 'REVOKED',
            config: { connectionString: 'nostr+walletconnect://gone' }
          }
        ]
      })
    )

    const check = await getRecoveryCheck({ tokenId: TOKEN, claimerId: CLAIMER })
    expect(check.mergeRequired).toBe(false)
  })

  it('handles a pubkey with no account yet (null claimer)', async () => {
    seedToken()
    seedAccounts(oldOwner())

    const check = await getRecoveryCheck({ tokenId: TOKEN, claimerId: null })

    expect(check.sameAccount).toBe(false)
    expect(check.mergeRequired).toBe(false)
    expect(check.existing).toEqual({
      lightningAddresses: [],
      cards: 0,
      remoteWallets: 0
    })
    expect(check.incoming.lightningAddresses).toEqual(['alice', 'alice2'])
    // Nothing is queried for the missing side.
    for (const fn of [
      prismaMock.lightningAddress.findMany,
      prismaMock.card.count,
      prismaMock.remoteWallet.count
    ]) {
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: FROM })
        })
      )
    }
  })
})

describe('accountHasData', () => {
  it('is false for an empty account', async () => {
    seedAccounts(emptyAccount(CLAIMER))
    expect(await accountHasData(prismaMock as any, CLAIMER)).toBe(false)
  })

  it('treats a wallet with no config as user data', async () => {
    seedAccounts(
      freshClaimer({
        wallets: [{ ...LNCURL_WALLET, id: 'w-x', config: null }]
      })
    )
    expect(await accountHasData(prismaMock as any, CLAIMER)).toBe(true)
  })
})

// ── recoverAccountViaCard ───────────────────────────────────────────────────

describe('recoverAccountViaCard', () => {
  describe('same account', () => {
    it('revokes the QR and moves nothing', async () => {
      seedToken()
      seedAccounts(oldOwner())

      const result = await recoverAccountViaCard({
        tokenId: TOKEN,
        claimerId: FROM
      })

      expect(result).toEqual({ outcome: 'same-account', cardId: CARD })
      expect(prismaMock.cardActivationToken.updateMany).toHaveBeenCalledTimes(1)
      expect(prismaMock.cardActivationToken.updateMany).toHaveBeenCalledWith({
        where: { id: TOKEN, status: 'PENDING' },
        data: { status: 'REVOKED' }
      })
      expect(reparentMock).not.toHaveBeenCalled()
      expect(prismaMock.card.findUnique).not.toHaveBeenCalled()
      expect(prismaMock.user.update).not.toHaveBeenCalled()
      expect(prismaMock.oAuthGrant.updateMany).not.toHaveBeenCalled()
      expect(prismaMock.accountRecovery.create).not.toHaveBeenCalled()
      expect(logActivity.fireAndForget).not.toHaveBeenCalled()
      expect(eventBus.emit).not.toHaveBeenCalled()
    })

    it('409s when the QR was revoked concurrently', async () => {
      seedToken()
      vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
        count: 0
      } as any)

      await expect(
        recoverAccountViaCard({ tokenId: TOKEN, claimerId: FROM })
      ).rejects.toBeInstanceOf(ConflictError)
    })
  })

  it('404s for a non-RECOVER token without burning it', async () => {
    seedToken({ purpose: 'ACTIVATE' })

    await expect(
      recoverAccountViaCard({ tokenId: TOKEN, claimerId: CLAIMER })
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(prismaMock.cardActivationToken.updateMany).not.toHaveBeenCalled()
  })

  it('409s for an expired token without burning it', async () => {
    seedToken({ expiresAt: new Date(Date.now() - 1) })

    await expect(
      recoverAccountViaCard({ tokenId: TOKEN, claimerId: CLAIMER })
    ).rejects.toBeInstanceOf(ConflictError)
    expect(prismaMock.cardActivationToken.updateMany).not.toHaveBeenCalled()
  })

  it('burns the token scoped to PENDING for the claimer', async () => {
    seedToken()
    seedCard()
    seedAccounts(oldOwner(), freshClaimer())

    await recoverAccountViaCard({ tokenId: TOKEN, claimerId: CLAIMER })

    expect(prismaMock.cardActivationToken.updateMany).toHaveBeenCalledWith({
      where: { id: TOKEN, status: 'PENDING' },
      data: {
        status: 'CLAIMED',
        claimedAt: expect.any(Date),
        claimedByUserId: CLAIMER
      }
    })
  })

  it('409s when the burn loses the race', async () => {
    seedToken()
    seedCard()
    seedAccounts(oldOwner(), freshClaimer())
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 0
    } as any)

    await expect(
      recoverAccountViaCard({ tokenId: TOKEN, claimerId: CLAIMER })
    ).rejects.toThrow('Already claimed')
    expect(prismaMock.card.findUnique).not.toHaveBeenCalled()
    expect(reparentMock).not.toHaveBeenCalled()
  })

  it.each([
    ['the card changed hands', { userId: 'someone-else' }],
    ['the card was unpaired', { userId: null }]
  ])('409s when %s', async (_label, card) => {
    seedToken()
    seedCard(card)
    seedAccounts(oldOwner(), freshClaimer())

    await expect(
      recoverAccountViaCard({ tokenId: TOKEN, claimerId: CLAIMER })
    ).rejects.toThrow(/changed hands/)
    expect(reparentMock).not.toHaveBeenCalled()
  })

  it('409s when the card row is gone', async () => {
    seedToken()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)
    seedAccounts(oldOwner(), freshClaimer())

    await expect(
      recoverAccountViaCard({ tokenId: TOKEN, claimerId: CLAIMER })
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it.each([
    ['blocked', { blockedAt: new Date() }, /blocked/],
    ['disabled', { disabledAt: new Date() }, /paused/]
  ])('409s when the card is %s', async (_label, card, message) => {
    seedToken()
    seedCard(card)
    seedAccounts(oldOwner(), freshClaimer())

    const err = await recoverAccountViaCard({
      tokenId: TOKEN,
      claimerId: CLAIMER
    }).catch(e => e)

    expect(err).toBeInstanceOf(ConflictError)
    expect(err.message).toMatch(message)
    expect(reparentMock).not.toHaveBeenCalled()
  })

  it('403s when the owner turned card recovery off', async () => {
    seedToken()
    seedCard()
    seedAccounts(oldOwner({ cardRecoveryEnabled: false }), freshClaimer())

    await expect(
      recoverAccountViaCard({ tokenId: TOKEN, claimerId: CLAIMER })
    ).rejects.toBeInstanceOf(AuthorizationError)
    expect(reparentMock).not.toHaveBeenCalled()
    expect(prismaMock.accountRecovery.create).not.toHaveBeenCalled()
  })

  it('404s when either account row is missing', async () => {
    seedToken()
    seedCard()
    seedAccounts(oldOwner())

    await expect(
      recoverAccountViaCard({ tokenId: TOKEN, claimerId: CLAIMER })
    ).rejects.toBeInstanceOf(NotFoundError)
  })

  it('refuses to merge into an account with data without confirmMerge', async () => {
    seedToken()
    seedCard()
    seedAccounts(
      oldOwner(),
      freshClaimer({ addresses: [{ username: 'bob', isPrimary: true }] })
    )

    const err = await recoverAccountViaCard({
      tokenId: TOKEN,
      claimerId: CLAIMER
    }).catch(e => e)

    expect(err).toBeInstanceOf(ConflictError)
    expect(err.details).toEqual({ reason: RECOVERY_MERGE_REQUIRED })
    expect(err.details.reason).toBe('RECOVERY_MERGE_REQUIRED')
    expect(reparentMock).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
    expect(prismaMock.accountRecovery.create).not.toHaveBeenCalled()
    expect(logActivity.fireAndForget).not.toHaveBeenCalled()
  })

  describe('fresh claimer', () => {
    async function recover() {
      seedToken()
      seedCard()
      seedAccounts(oldOwner(), freshClaimer())
      return recoverAccountViaCard({ tokenId: TOKEN, claimerId: CLAIMER })
    }

    const expectedSummary = {
      lightningAddresses: ['alice', 'alice2'],
      primaryAddress: 'alice',
      cards: [
        { id: CARD, title: 'Blue card', designImageUrl: 'https://img/1' },
        { id: 'card-other', title: null, designImageUrl: null }
      ],
      remoteWallets: [{ id: 'w-main', name: 'Main', isDefault: true }],
      vouchers: 2,
      recoveredWith: { cardId: CARD, title: 'Blue card' }
    }

    it('returns the recovered outcome with the summary', async () => {
      const result = await recover()

      expect(result).toEqual({
        outcome: 'recovered',
        cardId: CARD,
        recoveryId: 'recovery-1',
        fromUserId: FROM,
        mergedIntoExisting: false,
        summary: expectedSummary
      })
    })

    it('hands reparent both sides with their flag holders', async () => {
      await recover()

      expect(reparentMock).toHaveBeenCalledTimes(1)
      expect(reparentMock).toHaveBeenCalledWith(prismaMock, {
        fromId: FROM,
        toId: CLAIMER,
        target: { hasPrimaryAddress: false, hasDefaultWallet: true },
        incoming: {
          hasPrimaryAddress: true,
          wallets: [
            { id: 'w-main', name: 'Main', isDefault: true },
            { id: 'w-dead', name: 'Old', isDefault: false }
          ]
        }
      })
    })

    it('snapshots the summary before anything moves', async () => {
      await recover()

      const snapshot = vi.mocked(prismaMock.card.findMany).mock
        .invocationCallOrder[0]
      expect(snapshot).toBeLessThan(reparentMock.mock.invocationCallOrder[0])
    })

    it("copies the recovered account's settings as-is", async () => {
      await recover()

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: CLAIMER },
        data: {
          relays: JSON.stringify(['wss://old.example', 'wss://shared.example']),
          relaysUpdatedAt: RELAYS_UPDATED_AT,
          voucherSenderAllowlist: ['f'.repeat(64)],
          allowVouchers: true,
          voucherDepositPolicy: 'ALLOWLIST',
          currencyPrefs: { active: ['SAT', 'USD'], selected: 'USD' }
        }
      })
    })

    it('never copies the role or the recovery opt-out', async () => {
      await recover()

      const { data } = vi.mocked(prismaMock.user.update).mock.calls[0][0] as any
      expect(data).not.toHaveProperty('role')
      expect(data).not.toHaveProperty('pubkey')
      expect(data).not.toHaveProperty('cardRecoveryEnabled')
    })

    it('revokes pending tokens on every moved card', async () => {
      await recover()

      expect(prismaMock.cardActivationToken.updateMany).toHaveBeenCalledWith({
        where: { cardId: { in: [CARD, 'card-other'] }, status: 'PENDING' },
        data: { status: 'REVOKED' }
      })
    })

    it("revokes the old account's live OAuth grants without moving them", async () => {
      await recover()

      expect(prismaMock.oAuthGrant.updateMany).toHaveBeenCalledTimes(1)
      expect(prismaMock.oAuthGrant.updateMany).toHaveBeenCalledWith({
        where: { userId: FROM, revokedAt: null },
        data: { revokedAt: expect.any(Date) }
      })
    })

    it('records the recovery with its summary', async () => {
      await recover()

      expect(prismaMock.accountRecovery.create).toHaveBeenCalledWith({
        data: {
          fromUserId: FROM,
          toUserId: CLAIMER,
          cardId: CARD,
          tokenId: TOKEN,
          summary: expectedSummary,
          mergedIntoExisting: false
        },
        select: { id: true }
      })
    })

    it('logs WARN on both accounts and emits users/cards updates', async () => {
      await recover()

      const calls = vi
        .mocked(logActivity.fireAndForget)
        .mock.calls.map(c => c[0])
      expect(calls).toHaveLength(2)
      const metadata = {
        recoveryId: 'recovery-1',
        cardId: CARD,
        tokenId: TOKEN,
        fromUserId: FROM,
        toUserId: CLAIMER,
        mergedIntoExisting: false,
        lightningAddresses: ['alice', 'alice2'],
        cards: 2,
        remoteWallets: 1
      }
      expect(calls).toContainEqual(
        expect.objectContaining({
          category: 'USER',
          event: 'user.account_recovered',
          level: 'WARN',
          userId: CLAIMER,
          metadata
        })
      )
      expect(calls).toContainEqual(
        expect.objectContaining({
          category: 'USER',
          event: 'user.account_transferred_out',
          level: 'WARN',
          userId: FROM,
          metadata
        })
      )
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'users:updated' })
      )
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'cards:updated' })
      )
    })

    it('leaves relays and currency prefs alone when the old account had none', async () => {
      seedToken()
      seedCard()
      seedAccounts(
        oldOwner({ relays: null, relaysUpdatedAt: null, currencyPrefs: null }),
        freshClaimer()
      )

      await recoverAccountViaCard({ tokenId: TOKEN, claimerId: CLAIMER })

      const { data } = vi.mocked(prismaMock.user.update).mock.calls[0][0] as any
      expect(data).not.toHaveProperty('relays')
      expect(data).not.toHaveProperty('relaysUpdatedAt')
      expect(data).not.toHaveProperty('currencyPrefs')
      expect(data.allowVouchers).toBe(true)
    })

    it('stamps relaysUpdatedAt now when the old account never recorded one', async () => {
      seedToken()
      seedCard()
      seedAccounts(oldOwner({ relaysUpdatedAt: null }), freshClaimer())

      const before = Date.now()
      await recoverAccountViaCard({ tokenId: TOKEN, claimerId: CLAIMER })

      const { data } = vi.mocked(prismaMock.user.update).mock.calls[0][0] as any
      expect(data.relaysUpdatedAt).toBeInstanceOf(Date)
      expect(data.relaysUpdatedAt.getTime()).toBeGreaterThanOrEqual(before)
    })

    it('carries a null card title into recoveredWith', async () => {
      seedToken()
      seedCard({ title: null })
      seedAccounts(oldOwner(), freshClaimer())

      const result = await recoverAccountViaCard({
        tokenId: TOKEN,
        claimerId: CLAIMER
      })

      expect(result.outcome).toBe('recovered')
      if (result.outcome === 'recovered') {
        expect(result.summary.recoveredWith).toEqual({
          cardId: CARD,
          title: null
        })
      }
    })
  })

  describe('merge into an existing account', () => {
    function claimerWithData() {
      return freshClaimer({
        relays: JSON.stringify(['wss://mine.example', 'wss://shared.example']),
        relaysUpdatedAt: new Date('2020-01-01T00:00:00.000Z'),
        currencyPrefs: { active: ['SAT'], selected: 'SAT' },
        allowVouchers: false,
        voucherDepositPolicy: 'ANYONE',
        voucherSenderAllowlist: ['e'.repeat(64), 'f'.repeat(64)],
        addresses: [{ username: 'bob', isPrimary: true }]
      })
    }

    async function merge() {
      seedToken()
      seedCard()
      seedAccounts(oldOwner(), claimerWithData())
      return recoverAccountViaCard({
        tokenId: TOKEN,
        claimerId: CLAIMER,
        confirmMerge: true
      })
    }

    it('unions relays and the allowlist and keeps the claimer settings', async () => {
      const before = Date.now()
      await merge()

      const { where, data } = vi.mocked(prismaMock.user.update).mock
        .calls[0][0] as any
      expect(where).toEqual({ id: CLAIMER })
      expect(data.relays).toBe(
        JSON.stringify([
          'wss://mine.example',
          'wss://shared.example',
          'wss://old.example'
        ])
      )
      // A merged list is new, so it's stamped now rather than copied.
      expect(data.relaysUpdatedAt).toBeInstanceOf(Date)
      expect(data.relaysUpdatedAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(data.voucherSenderAllowlist).toEqual([
        'e'.repeat(64),
        'f'.repeat(64)
      ])
      expect(data).not.toHaveProperty('allowVouchers')
      expect(data).not.toHaveProperty('voucherDepositPolicy')
      expect(data).not.toHaveProperty('currencyPrefs')
    })

    it('marks the recovery as merged', async () => {
      const result = await merge()

      expect(result).toMatchObject({
        outcome: 'recovered',
        mergedIntoExisting: true
      })
      expect(prismaMock.accountRecovery.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ mergedIntoExisting: true })
        })
      )
      expect(logActivity.fireAndForget).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'user.account_recovered',
          metadata: expect.objectContaining({ mergedIntoExisting: true })
        })
      )
    })

    it("passes the claimer's primary address to reparent so it is kept", async () => {
      await merge()

      expect(reparentMock).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({
          target: { hasPrimaryAddress: true, hasDefaultWallet: true }
        })
      )
    })
  })
})

// ── transfer notice ─────────────────────────────────────────────────────────

describe('getAccountTransferNotice', () => {
  it('returns null when there is no open notice', async () => {
    vi.mocked(prismaMock.accountRecovery.findFirst).mockResolvedValue(null)

    expect(await getAccountTransferNotice(FROM)).toBeNull()
    expect(prismaMock.accountRecovery.findFirst).toHaveBeenCalledWith({
      where: { fromUserId: FROM, noticeDismissedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, summary: true }
    })
  })

  it('maps the stored summary to the notice shape', async () => {
    vi.mocked(prismaMock.accountRecovery.findFirst).mockResolvedValue({
      id: 'recovery-1',
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
      summary: {
        lightningAddresses: ['alice', 'alice2'],
        primaryAddress: 'alice',
        cards: [
          { id: CARD, title: 'Blue card', designImageUrl: null },
          { id: 'card-other', title: null, designImageUrl: null }
        ],
        remoteWallets: [{ id: 'w-main', name: 'Main', isDefault: true }],
        vouchers: 0,
        recoveredWith: { cardId: CARD, title: 'Blue card' }
      }
    } as any)

    expect(await getAccountTransferNotice(FROM)).toEqual({
      id: 'recovery-1',
      transferredAt: '2026-10-20T12:00:00.000Z',
      cardTitle: 'Blue card',
      lightningAddresses: ['alice', 'alice2'],
      cards: 2,
      remoteWallets: 1
    })
  })

  it('tolerates a partial summary', async () => {
    vi.mocked(prismaMock.accountRecovery.findFirst).mockResolvedValue({
      id: 'recovery-2',
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
      summary: {}
    } as any)

    expect(await getAccountTransferNotice(FROM)).toEqual({
      id: 'recovery-2',
      transferredAt: '2026-10-20T12:00:00.000Z',
      cardTitle: null,
      lightningAddresses: [],
      cards: 0,
      remoteWallets: 0
    })
  })
})

describe('dismissAccountTransferNotices', () => {
  it('stamps every open notice for the user and returns the count', async () => {
    vi.mocked(prismaMock.accountRecovery.updateMany).mockResolvedValue({
      count: 2
    } as any)

    expect(await dismissAccountTransferNotices(FROM)).toBe(2)
    expect(prismaMock.accountRecovery.updateMany).toHaveBeenCalledWith({
      where: { fromUserId: FROM, noticeDismissedAt: null },
      data: { noticeDismissedAt: expect.any(Date) }
    })
  })
})

// ── opt-out ─────────────────────────────────────────────────────────────────

describe('setCardRecoveryEnabled', () => {
  it('enabling flips the flag and revokes nothing', async () => {
    const result = await setCardRecoveryEnabled(FROM, true)

    expect(result).toEqual({ enabled: true, revokedTokens: 0 })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: FROM },
      data: { cardRecoveryEnabled: true }
    })
    expect(prismaMock.cardActivationToken.updateMany).not.toHaveBeenCalled()
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.card_recovery_setting_changed',
        level: 'INFO',
        userId: FROM,
        metadata: { enabled: true, revokedTokens: 0 }
      })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'users:updated' })
    )
  })

  it("disabling revokes the account's pending RECOVER tokens only", async () => {
    vi.mocked(prismaMock.cardActivationToken.updateMany).mockResolvedValue({
      count: 3
    } as any)

    const result = await setCardRecoveryEnabled(FROM, false)

    expect(result).toEqual({ enabled: false, revokedTokens: 3 })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: FROM },
      data: { cardRecoveryEnabled: false }
    })
    expect(prismaMock.cardActivationToken.updateMany).toHaveBeenCalledWith({
      where: {
        purpose: 'RECOVER',
        recoverFromUserId: FROM,
        status: 'PENDING'
      },
      data: { status: 'REVOKED' }
    })
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'WARN',
        metadata: { enabled: false, revokedTokens: 3 }
      })
    )
  })
})
