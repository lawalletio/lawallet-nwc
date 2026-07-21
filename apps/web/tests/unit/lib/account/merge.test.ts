import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { secret: 'a'.repeat(48), enabled: true },
    isDevelopment: false,
    isTest: true,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: vi.fn(() => undefined),
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    ACCOUNT_PUBKEY_LINKED: 'user.account_pubkey_linked',
    ACCOUNT_PUBKEY_UNLINKED: 'user.account_pubkey_unlinked',
    ACCOUNT_PRIMARY_CHANGED: 'user.account_primary_changed',
    ACCOUNT_MERGED: 'user.account_merged',
  },
  logActivity: { fireAndForget: vi.fn() },
}))

// summarizeAccount resolves the primary pubkey's kind-0 through the server
// cache; the engine tests don't exercise relay behavior.
vi.mock('@/lib/nostr/profile-cache', () => ({
  resolveProfiles: vi.fn(async () => []),
}))

import {
  mergeAccounts,
  previewMerge,
  linkPubkeyToAccount,
  setPrimaryIdentity,
  unlinkIdentity,
} from '@/lib/account/merge'
import { logActivity } from '@/lib/activity-log'
import { ConflictError, NotFoundError, ValidationError } from '@/types/server/errors'

const A = 'user-a'
const B = 'user-b'
const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)

/** Seeds the two tx.user.findUnique calls made at the top of mergeAccounts. */
function seedMergeUsers(overrides?: {
  survivor?: Partial<Record<string, unknown>>
  absorbed?: Partial<Record<string, unknown>>
}) {
  const survivor = {
    id: A,
    pubkey: PK_A,
    relays: null,
    managedNostrKey: null,
    albySubAccount: null,
    lightningAddresses: [{ username: 'alice', isPrimary: true }],
    remoteWallets: [{ id: 'wa-default', isDefault: true }],
    ...overrides?.survivor,
  }
  const absorbed = {
    id: B,
    pubkey: PK_B,
    relays: null,
    managedNostrKey: null,
    albySubAccount: null,
    nostrIdentities: [{ pubkey: PK_B }],
    lightningAddresses: [{ username: 'bob' }],
    remoteWallets: [{ id: 'wb-1', name: 'NWC Wallet' }],
    ...overrides?.absorbed,
  }
  vi.mocked(prismaMock.user.findUnique).mockImplementation((args: any) =>
    Promise.resolve(args.where.id === A ? survivor : args.where.id === B ? absorbed : null) as any
  )
  return { survivor, absorbed }
}

function seedMergeDefaults() {
  // Survivor's identities (for the combined-pubkey check) + wallet names.
  vi.mocked(prismaMock.nostrIdentity.findMany).mockResolvedValue([
    { pubkey: PK_A },
  ] as any)
  vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([
    { name: 'NWC Wallet' },
  ] as any)
  const count = { count: 1 }
  vi.mocked(prismaMock.nostrIdentity.updateMany).mockResolvedValue(count as any)
  vi.mocked(prismaMock.passkeyCredential.updateMany).mockResolvedValue(count as any)
  vi.mocked(prismaMock.lightningAddress.updateMany).mockResolvedValue(count as any)
  vi.mocked(prismaMock.remoteWallet.updateMany).mockResolvedValue(count as any)
  vi.mocked(prismaMock.card.updateMany).mockResolvedValue(count as any)
  vi.mocked(prismaMock.ntag424.updateMany).mockResolvedValue(count as any)
  vi.mocked(prismaMock.cardDesign.updateMany).mockResolvedValue(count as any)
  vi.mocked(prismaMock.invoice.updateMany).mockResolvedValue(count as any)
  vi.mocked(prismaMock.activityLog.updateMany).mockResolvedValue(count as any)
}

describe('mergeAccounts', () => {
  beforeEach(() => {
    resetPrismaMock()
    vi.clearAllMocks()
  })

  it('rejects self-merge', async () => {
    await expect(
      mergeAccounts({ survivorId: A, absorbedId: A, mainPubkey: PK_A })
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('refuses when the absorbed account custodies a never-exported key', async () => {
    seedMergeUsers({
      absorbed: { managedNostrKey: { exportedAt: null } },
    })
    seedMergeDefaults()

    await expect(
      mergeAccounts({ survivorId: A, absorbedId: B, mainPubkey: PK_A })
    ).rejects.toBeInstanceOf(ConflictError)
    // Nothing was written.
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
    expect(prismaMock.nostrIdentity.updateMany).not.toHaveBeenCalled()
  })

  it('allows the merge when the absorbed custodied key was exported, and drops it', async () => {
    seedMergeUsers({
      absorbed: { managedNostrKey: { exportedAt: new Date() } },
    })
    seedMergeDefaults()

    await mergeAccounts({ survivorId: A, absorbedId: B, mainPubkey: PK_A })
    expect(prismaMock.managedNostrKey.delete).toHaveBeenCalledWith({
      where: { userId: B },
    })
  })

  it('rejects a mainPubkey that belongs to neither account', async () => {
    seedMergeUsers()
    seedMergeDefaults()

    await expect(
      mergeAccounts({ survivorId: A, absorbedId: B, mainPubkey: 'c'.repeat(64) })
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('re-parents resources, deletes the shell, settles the primary, and mirrors User.pubkey', async () => {
    seedMergeUsers()
    seedMergeDefaults()

    const result = await mergeAccounts({
      survivorId: A,
      absorbedId: B,
      mainPubkey: PK_B,
    })

    // Incoming identities re-parent with isPrimary cleared.
    expect(prismaMock.nostrIdentity.updateMany).toHaveBeenCalledWith({
      where: { userId: B },
      data: { userId: A, isPrimary: false },
    })
    // Every owned model re-parents.
    for (const model of [
      prismaMock.passkeyCredential,
      prismaMock.lightningAddress,
      prismaMock.remoteWallet,
      prismaMock.card,
      prismaMock.ntag424,
      prismaMock.cardDesign,
      prismaMock.invoice,
      prismaMock.activityLog,
    ]) {
      expect(model.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: B } })
      )
    }
    // Shell deleted BEFORE the primary settles (User.pubkey unique).
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: B } })
    // Chosen main pubkey becomes primary and mirrors onto User.pubkey.
    expect(prismaMock.nostrIdentity.update).toHaveBeenCalledWith({
      where: { pubkey: PK_B },
      data: { isPrimary: true },
    })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: A },
      data: { pubkey: PK_B },
    })
    expect(result.mainPubkey).toBe(PK_B)
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'user.account_merged', level: 'WARN' })
    )
  })

  it('keeps the survivor primary flags: clears incoming isPrimary/isDefault when the survivor has them', async () => {
    seedMergeUsers()
    seedMergeDefaults()

    await mergeAccounts({ survivorId: A, absorbedId: B, mainPubkey: PK_A })

    expect(prismaMock.lightningAddress.updateMany).toHaveBeenCalledWith({
      where: { userId: B, isPrimary: true },
      data: { isPrimary: false },
    })
    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith({
      where: { userId: B, isDefault: true },
      data: { isDefault: false },
    })
  })

  it('suffixes colliding incoming wallet names', async () => {
    seedMergeUsers()
    seedMergeDefaults()

    await mergeAccounts({ survivorId: A, absorbedId: B, mainPubkey: PK_A })

    // Incoming 'NWC Wallet' collides with the survivor's → renamed '(2)'.
    expect(prismaMock.remoteWallet.update).toHaveBeenCalledWith({
      where: { id: 'wb-1' },
      data: { name: 'NWC Wallet (2)' },
    })
  })

  it('applies the chosen primary address and default wallet (clear-then-set)', async () => {
    seedMergeUsers()
    seedMergeDefaults()

    await mergeAccounts({
      survivorId: A,
      absorbedId: B,
      mainPubkey: PK_A,
      resolutions: { primaryAddressUsername: 'bob', defaultWalletId: 'wb-1' },
    })

    // Address: clear every survivor-scope primary, then set the chosen one.
    expect(prismaMock.lightningAddress.updateMany).toHaveBeenCalledWith({
      where: { userId: A, isPrimary: true },
      data: { isPrimary: false },
    })
    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith({
      where: { username: 'bob' },
      data: { isPrimary: true },
    })
    // Wallet: same clear-then-set under the survivor scope.
    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith({
      where: { userId: A, isDefault: true },
      data: { isDefault: false },
    })
    expect(prismaMock.remoteWallet.update).toHaveBeenCalledWith({
      where: { id: 'wb-1' },
      data: { isDefault: true },
    })
  })

  it('rejects resolutions referencing resources outside the two accounts', async () => {
    seedMergeUsers()
    seedMergeDefaults()
    await expect(
      mergeAccounts({
        survivorId: A,
        absorbedId: B,
        mainPubkey: PK_A,
        resolutions: { primaryAddressUsername: 'mallory' },
      })
    ).rejects.toBeInstanceOf(ValidationError)

    seedMergeUsers()
    seedMergeDefaults()
    await expect(
      mergeAccounts({
        survivorId: A,
        absorbedId: B,
        mainPubkey: PK_A,
        resolutions: { defaultWalletId: 'not-theirs' },
      })
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('unions both relay lists onto the survivor', async () => {
    seedMergeUsers({
      survivor: { relays: JSON.stringify(['wss://a.example', 'wss://shared.example']) },
      absorbed: { relays: JSON.stringify(['wss://b.example', 'wss://shared.example']) },
    })
    seedMergeDefaults()

    const result = await mergeAccounts({
      survivorId: A,
      absorbedId: B,
      mainPubkey: PK_A,
    })

    expect(result.mergedRelays).toBe(3)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: A },
      data: expect.objectContaining({
        pubkey: PK_A,
        relays: JSON.stringify([
          'wss://a.example',
          'wss://shared.example',
          'wss://b.example',
        ]),
      }),
    })
  })

  it('drops the absorbed AlbySubAccount when the survivor has one, moves it otherwise', async () => {
    seedMergeUsers({
      survivor: { albySubAccount: { appId: 1 } },
      absorbed: { albySubAccount: { appId: 2 } },
    })
    seedMergeDefaults()
    await mergeAccounts({ survivorId: A, absorbedId: B, mainPubkey: PK_A })
    expect(prismaMock.albySubAccount.delete).toHaveBeenCalledWith({
      where: { userId: B },
    })

    vi.clearAllMocks()
    resetPrismaMock()
    seedMergeUsers({ absorbed: { albySubAccount: { appId: 2 } } })
    seedMergeDefaults()
    await mergeAccounts({ survivorId: A, absorbedId: B, mainPubkey: PK_A })
    expect(prismaMock.albySubAccount.update).toHaveBeenCalledWith({
      where: { userId: B },
      data: { userId: A },
    })
  })
})

describe('previewMerge', () => {
  beforeEach(() => {
    resetPrismaMock()
    vi.clearAllMocks()
  })

  function seedSummaries(absorbedManaged: { exportedAt: Date | null } | null) {
    vi.mocked(prismaMock.user.findUnique).mockImplementation((args: any) => {
      const base = {
        relays: null,
        nostrIdentities: [],
        lightningAddresses: [],
        remoteWallets: [],
        albySubAccount: null,
        _count: {
          passkeyCredentials: 0,
          cards: 0,
          cardDesigns: 0,
          invoices: 0,
        },
      }
      if (args.where.id === A) {
        return Promise.resolve({ ...base, id: A, pubkey: PK_A, managedNostrKey: null }) as any
      }
      if (args.where.id === B) {
        return Promise.resolve({
          ...base,
          id: B,
          pubkey: PK_B,
          managedNostrKey: absorbedManaged,
        }) as any
      }
      return Promise.resolve(null) as any
    })
  }

  it('blocks when the absorbed account has an unexported custodied key', async () => {
    seedSummaries({ exportedAt: null })
    const preview = await previewMerge(A, B)
    expect(preview.blocked).toBe(true)
    expect(preview.collisions[0].kind).toBe('managed-key-unexported')
  })

  it('does not block when the key was exported', async () => {
    seedSummaries({ exportedAt: new Date() })
    const preview = await previewMerge(A, B)
    expect(preview.blocked).toBe(false)
  })

  it('404s on a missing account', async () => {
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null as any)
    await expect(previewMerge(A, B)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('identity mutations', () => {
  beforeEach(() => {
    resetPrismaMock()
    vi.clearAllMocks()
  })

  it('linkPubkeyToAccount maps P2002 to 409', async () => {
    vi.mocked(prismaMock.nostrIdentity.create).mockRejectedValue({ code: 'P2002' })
    await expect(linkPubkeyToAccount(A, PK_B)).rejects.toBeInstanceOf(ConflictError)
  })

  it('setPrimaryIdentity clears, sets, and mirrors onto User.pubkey', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      pubkey: PK_B,
      userId: A,
      isPrimary: false,
    } as any)

    await setPrimaryIdentity(A, PK_B)

    expect(prismaMock.nostrIdentity.updateMany).toHaveBeenCalledWith({
      where: { userId: A, isPrimary: true },
      data: { isPrimary: false },
    })
    expect(prismaMock.nostrIdentity.update).toHaveBeenCalledWith({
      where: { pubkey: PK_B },
      data: { isPrimary: true },
    })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: A },
      data: { pubkey: PK_B },
    })
  })

  it('setPrimaryIdentity 404s for a foreign identity', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      pubkey: PK_B,
      userId: 'someone-else',
      isPrimary: false,
    } as any)
    await expect(setPrimaryIdentity(A, PK_B)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('unlinkIdentity refuses the primary and the last identity', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      pubkey: PK_A,
      userId: A,
      isPrimary: true,
    } as any)
    await expect(unlinkIdentity(A, PK_A)).rejects.toBeInstanceOf(ConflictError)

    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      pubkey: PK_B,
      userId: A,
      isPrimary: false,
    } as any)
    vi.mocked(prismaMock.nostrIdentity.count).mockResolvedValue(1 as any)
    await expect(unlinkIdentity(A, PK_B)).rejects.toBeInstanceOf(ConflictError)
  })

  it('unlinkIdentity deletes a secondary when others remain', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      pubkey: PK_B,
      userId: A,
      isPrimary: false,
    } as any)
    vi.mocked(prismaMock.nostrIdentity.count).mockResolvedValue(2 as any)
    await unlinkIdentity(A, PK_B)
    expect(prismaMock.nostrIdentity.delete).toHaveBeenCalledWith({
      where: { pubkey: PK_B },
    })
  })
})
