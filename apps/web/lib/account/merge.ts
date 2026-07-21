import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/generated/prisma'
import { ConflictError, NotFoundError, ValidationError } from '@/types/server/errors'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { parseStoredRelays } from '@/lib/nostr/relay-list'
import { resolveProfiles } from '@/lib/nostr/profile-cache'

type Tx = Prisma.TransactionClient

/**
 * Per-account snapshot shown in the side-by-side merge preview, with enough
 * detail for the resolve step's conflict choices (primary address, default
 * wallet, profile fields, relays).
 */
export interface AccountResourceSummary {
  userId: string
  primaryPubkey: string
  identities: { pubkey: string; isPrimary: boolean; label: string | null }[]
  passkeys: number
  lightningAddresses: string[]
  /** Username of the primary lightning address, when one exists. */
  primaryAddress: string | null
  remoteWallets: number
  /** Full wallet list so the wizard can offer a default-wallet choice. */
  wallets: { id: string; name: string; isDefault: boolean }[]
  cards: number
  cardDesigns: number
  invoices: number
  /** NIP-65 relay list stored for this account (empty = operator defaults). */
  relays: string[]
  /**
   * Cached kind-0 profile of the account's primary pubkey, when resolved.
   * Lets the wizard offer per-field (avatar / display name) choices.
   */
  profile: { name?: string; displayName?: string; picture?: string } | null
  hasAlbySubAccount: boolean
  hasManagedKey: boolean
  managedKeyExported: boolean
}

export interface MergeCollision {
  kind:
    | 'managed-key-unexported'
    | 'managed-key-dropped'
    | 'alby-subaccount-dropped'
    | 'wallet-name-renamed'
    | 'primary-address-kept'
    | 'default-wallet-kept'
  detail: string
}

export interface MergePreview {
  survivor: AccountResourceSummary
  absorbed: AccountResourceSummary
  collisions: MergeCollision[]
  /** True when the merge would be refused (unexported custodied key). */
  blocked: boolean
}

async function summarizeAccount(userId: string): Promise<AccountResourceSummary> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      pubkey: true,
      relays: true,
      nostrIdentities: {
        select: { pubkey: true, isPrimary: true, label: true },
        orderBy: { createdAt: 'asc' }
      },
      managedNostrKey: { select: { exportedAt: true } },
      albySubAccount: { select: { appId: true } },
      lightningAddresses: { select: { username: true, isPrimary: true } },
      remoteWallets: {
        select: { id: true, name: true, isDefault: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
      },
      _count: {
        select: {
          passkeyCredentials: true,
          cards: true,
          cardDesigns: true,
          invoices: true
        }
      }
    }
  })
  if (!user) throw new NotFoundError('Account not found')

  // Best-effort profile lookup for the primary pubkey (serves the wizard's
  // avatar / display-name choices). A relay hiccup must never break preview.
  let profile: AccountResourceSummary['profile'] = null
  try {
    const [resolved] = await resolveProfiles([user.pubkey])
    if (resolved) {
      profile = {
        name: resolved.name,
        displayName: resolved.displayName,
        picture: resolved.picture
      }
    }
  } catch {
    profile = null
  }

  return {
    userId: user.id,
    primaryPubkey: user.pubkey,
    identities: user.nostrIdentities,
    passkeys: user._count.passkeyCredentials,
    lightningAddresses: user.lightningAddresses.map(a => a.username),
    primaryAddress:
      user.lightningAddresses.find(a => a.isPrimary)?.username ?? null,
    remoteWallets: user.remoteWallets.length,
    wallets: user.remoteWallets,
    cards: user._count.cards,
    cardDesigns: user._count.cardDesigns,
    invoices: user._count.invoices,
    relays: parseStoredRelays(user.relays),
    profile,
    hasAlbySubAccount: !!user.albySubAccount,
    hasManagedKey: !!user.managedNostrKey,
    managedKeyExported: !!user.managedNostrKey?.exportedAt
  }
}

/**
 * Dry-run of {@link mergeAccounts}: what the two accounts hold, which
 * collisions the merge would reconcile, and whether it is blocked outright.
 * Read-only — safe to call repeatedly for the preview UI.
 */
export async function previewMerge(
  survivorId: string,
  absorbedId: string
): Promise<MergePreview> {
  if (survivorId === absorbedId) {
    throw new ValidationError('Cannot merge an account with itself')
  }
  const [survivor, absorbed] = await Promise.all([
    summarizeAccount(survivorId),
    summarizeAccount(absorbedId)
  ])

  const collisions: MergeCollision[] = []
  let blocked = false

  if (absorbed.hasManagedKey && !absorbed.managedKeyExported) {
    blocked = true
    collisions.push({
      kind: 'managed-key-unexported',
      detail:
        'The other account has a server-custodied secret key that was never exported. Export it from that account before merging — merging would destroy it.'
    })
  } else if (absorbed.hasManagedKey && survivor.hasManagedKey) {
    collisions.push({
      kind: 'managed-key-dropped',
      detail:
        "Both accounts have a custodied key; the current account's key is kept and the other (already exported) is removed."
    })
  }

  if (absorbed.hasAlbySubAccount && survivor.hasAlbySubAccount) {
    collisions.push({
      kind: 'alby-subaccount-dropped',
      detail:
        "Both accounts have an Alby sub-account (one per account); the other account's link is dropped. Its wallet connection is kept as a regular remote wallet."
    })
  }

  if (survivor.primaryAddress && absorbed.primaryAddress) {
    collisions.push({
      kind: 'primary-address-kept',
      detail:
        "Both accounts have a primary lightning address — you'll choose which one stays primary."
    })
  }
  if (
    survivor.wallets.some(w => w.isDefault) &&
    absorbed.wallets.some(w => w.isDefault)
  ) {
    collisions.push({
      kind: 'default-wallet-kept',
      detail:
        "Both accounts have a default wallet — you'll choose which one stays default. Identically-named incoming wallets are renamed with a suffix."
    })
  }

  return { survivor, absorbed, collisions, blocked }
}

/**
 * Renames the incoming wallets that would collide with the survivor's under
 * `@@unique([userId, name])`. `taken` is seeded with BOTH sides' names so a
 * generated suffix can't collide with another incoming wallet either.
 */
async function reconcileWalletNames(
  tx: Tx,
  survivorId: string,
  incoming: { id: string; name: string }[]
): Promise<void> {
  const survivorWallets = await tx.remoteWallet.findMany({
    where: { userId: survivorId },
    select: { name: true }
  })
  const survivorNames = new Set(survivorWallets.map(w => w.name))
  const taken = new Set([...survivorNames, ...incoming.map(w => w.name)])

  for (const wallet of incoming) {
    if (!survivorNames.has(wallet.name)) continue
    let candidate: string
    for (let i = 2; ; i++) {
      candidate = `${wallet.name} (${i})`
      if (!taken.has(candidate)) break
    }
    taken.add(candidate)
    await tx.remoteWallet.update({
      where: { id: wallet.id },
      data: { name: candidate }
    })
  }
}

export interface MergeResult {
  survivorId: string
  mainPubkey: string
  movedIdentities: number
  movedPasskeys: number
  movedAddresses: number
  movedWallets: number
  /** Size of the merged (unioned) relay list on the surviving account. */
  mergedRelays: number
}

/**
 * User-selected answers to merge conflicts, gathered by the wizard's resolve
 * step. Everything is optional — omitted fields fall back to the engine's
 * survivor-wins defaults.
 */
export interface MergeResolutions {
  /** Username (from either account) that stays the primary lightning address. */
  primaryAddressUsername?: string
  /** Wallet id (from either account) that stays the default wallet. */
  defaultWalletId?: string
}

/**
 * Merges account `absorbedId` into `survivorId` inside one transaction:
 * every resource is re-parented onto the survivor, per-user uniqueness
 * collisions are reconciled, the absorbed User row is deleted, and
 * `mainPubkey` — any of the combined identities — becomes the primary.
 * Relay lists are always unioned onto the survivor.
 *
 * Conflict outcomes honor {@link MergeResolutions} when provided (which
 * address stays primary, which wallet stays default); otherwise the
 * survivor's win. Colliding wallet names get a suffix either way.
 *
 * Refused (409) when the absorbed account custodies a never-exported key:
 * deleting it would permanently destroy a secret only the server holds.
 */
export async function mergeAccounts(params: {
  survivorId: string
  absorbedId: string
  mainPubkey: string
  resolutions?: MergeResolutions
}): Promise<MergeResult> {
  const { survivorId, absorbedId, mainPubkey, resolutions = {} } = params
  if (survivorId === absorbedId) {
    throw new ValidationError('Cannot merge an account with itself')
  }

  const result = await prisma.$transaction(async tx => {
    const [survivor, absorbed] = await Promise.all([
      tx.user.findUnique({
        where: { id: survivorId },
        select: {
          id: true,
          pubkey: true,
          relays: true,
          managedNostrKey: { select: { exportedAt: true } },
          albySubAccount: { select: { appId: true } },
          lightningAddresses: { select: { username: true, isPrimary: true } },
          remoteWallets: { select: { id: true, isDefault: true } }
        }
      }),
      tx.user.findUnique({
        where: { id: absorbedId },
        select: {
          id: true,
          pubkey: true,
          relays: true,
          managedNostrKey: { select: { exportedAt: true } },
          albySubAccount: { select: { appId: true } },
          nostrIdentities: { select: { pubkey: true } },
          lightningAddresses: { select: { username: true } },
          remoteWallets: { select: { id: true, name: true } }
        }
      })
    ])
    if (!survivor || !absorbed) throw new NotFoundError('Account not found')

    // Custody guard: never destroy a key the user provably doesn't hold.
    if (absorbed.managedNostrKey && !absorbed.managedNostrKey.exportedAt) {
      throw new ConflictError(
        'The other account has a custodied secret key that was never exported. Export it before merging.'
      )
    }

    // The chosen main pubkey must be one of the combined identities.
    const combined = new Set<string>([
      ...(await tx.nostrIdentity.findMany({
        where: { userId: survivorId },
        select: { pubkey: true }
      })).map(i => i.pubkey),
      ...absorbed.nostrIdentities.map(i => i.pubkey)
    ])
    if (!combined.has(mainPubkey)) {
      throw new ValidationError(
        'mainPubkey must be one of the merged accounts’ linked pubkeys'
      )
    }

    // Resolutions may only reference resources of the two merging accounts.
    const combinedUsernames = new Set([
      ...survivor.lightningAddresses.map(a => a.username),
      ...absorbed.lightningAddresses.map(a => a.username)
    ])
    if (
      resolutions.primaryAddressUsername &&
      !combinedUsernames.has(resolutions.primaryAddressUsername)
    ) {
      throw new ValidationError(
        'primaryAddressUsername must belong to one of the merged accounts'
      )
    }
    const combinedWalletIds = new Set([
      ...survivor.remoteWallets.map(w => w.id),
      ...absorbed.remoteWallets.map(w => w.id)
    ])
    if (
      resolutions.defaultWalletId &&
      !combinedWalletIds.has(resolutions.defaultWalletId)
    ) {
      throw new ValidationError(
        'defaultWalletId must belong to one of the merged accounts'
      )
    }

    // ── 1:1 rows first (survivor's always win) ────────────────────────────
    if (absorbed.managedNostrKey) {
      // Always dropped, never moved: the export guard above proves the user
      // holds the key themselves, and the vault ciphertext is AAD-bound to
      // the absorbed userId — re-homing it without re-encryption would
      // produce an undecryptable row.
      await tx.managedNostrKey.delete({ where: { userId: absorbedId } })
    }
    if (absorbed.albySubAccount) {
      if (survivor.albySubAccount) {
        // One sub-account per user; the wallet connection itself lives on as
        // a RemoteWallet row (moved below), so only the 1:1 link is dropped.
        await tx.albySubAccount.delete({ where: { userId: absorbedId } })
      } else {
        await tx.albySubAccount.update({
          where: { userId: absorbedId },
          data: { userId: survivorId }
        })
      }
    }

    // ── Partial-unique flags: survivor keeps primacy (default). The user's
    // explicit choice, when given, is applied after the re-parent — here we
    // only make sure two flag-holders never coexist under one userId, which
    // the partial unique indexes reject mid-statement.
    const survivorHasPrimaryAddress = survivor.lightningAddresses.some(
      a => a.isPrimary
    )
    if (survivorHasPrimaryAddress) {
      await tx.lightningAddress.updateMany({
        where: { userId: absorbedId, isPrimary: true },
        data: { isPrimary: false }
      })
    }
    const survivorHasDefaultWallet = survivor.remoteWallets.some(
      w => w.isDefault
    )
    if (survivorHasDefaultWallet) {
      await tx.remoteWallet.updateMany({
        where: { userId: absorbedId, isDefault: true },
        data: { isDefault: false }
      })
    }

    // ── Wallet name collisions: suffix incoming ──────────────────────────
    await reconcileWalletNames(tx, survivorId, absorbed.remoteWallets)

    // ── Bulk re-parent (all FKs point at User.id) ────────────────────────
    const [identities, passkeys, addresses, wallets] = await Promise.all([
      tx.nostrIdentity.updateMany({
        // Incoming identities all become secondaries; primary is settled below.
        where: { userId: absorbedId },
        data: { userId: survivorId, isPrimary: false }
      }),
      tx.passkeyCredential.updateMany({
        where: { userId: absorbedId },
        data: { userId: survivorId }
      }),
      tx.lightningAddress.updateMany({
        where: { userId: absorbedId },
        data: { userId: survivorId }
      }),
      tx.remoteWallet.updateMany({
        where: { userId: absorbedId },
        data: { userId: survivorId }
      })
    ])
    await tx.card.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } })
    await tx.ntag424.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } })
    await tx.cardDesign.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } })
    await tx.invoice.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } })
    // Audit history follows the surviving account instead of being nulled.
    await tx.activityLog.updateMany({ where: { userId: absorbedId }, data: { userId: survivorId } })

    // ── Delete the empty shell BEFORE settling the primary: its
    // User.pubkey would collide with the survivor's mirror if the chosen
    // main pubkey is the absorbed account's. Everything was re-parented, so
    // the cascade has nothing left to take.
    await tx.user.delete({ where: { id: absorbedId } })

    // ── Apply the user's conflict choices (clear-then-set under the
    // partial unique indexes; everything now lives under survivorId) ─────
    if (resolutions.primaryAddressUsername) {
      await tx.lightningAddress.updateMany({
        where: { userId: survivorId, isPrimary: true },
        data: { isPrimary: false }
      })
      await tx.lightningAddress.update({
        where: { username: resolutions.primaryAddressUsername },
        data: { isPrimary: true }
      })
    }
    if (resolutions.defaultWalletId) {
      await tx.remoteWallet.updateMany({
        where: { userId: survivorId, isDefault: true },
        data: { isDefault: false }
      })
      await tx.remoteWallet.update({
        where: { id: resolutions.defaultWalletId },
        data: { isDefault: true }
      })
    }

    // ── Relays: union both lists onto the survivor ───────────────────────
    const mergedRelays = Array.from(
      new Set([
        ...parseStoredRelays(survivor.relays),
        ...parseStoredRelays(absorbed.relays)
      ])
    )

    // ── Settle the primary identity + the User.pubkey mirror ─────────────
    await tx.nostrIdentity.updateMany({
      where: { userId: survivorId, isPrimary: true },
      data: { isPrimary: false }
    })
    await tx.nostrIdentity.update({
      where: { pubkey: mainPubkey },
      data: { isPrimary: true }
    })
    await tx.user.update({
      where: { id: survivorId },
      data: {
        pubkey: mainPubkey,
        ...(mergedRelays.length > 0
          ? { relays: JSON.stringify(mergedRelays), relaysUpdatedAt: new Date() }
          : {})
      }
    })

    return {
      survivorId,
      mainPubkey,
      movedIdentities: identities.count,
      movedPasskeys: passkeys.count,
      movedAddresses: addresses.count,
      movedWallets: wallets.count,
      mergedRelays: mergedRelays.length,
      absorbedPubkey: absorbed.pubkey
    }
  })

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.ACCOUNT_MERGED,
    level: 'WARN',
    message: `Account ${result.absorbedPubkey.slice(0, 8)}… merged into ${result.mainPubkey.slice(0, 8)}…`,
    userId: result.survivorId,
    metadata: {
      absorbedPubkey: result.absorbedPubkey,
      mainPubkey: result.mainPubkey,
      movedIdentities: result.movedIdentities,
      movedPasskeys: result.movedPasskeys,
      movedAddresses: result.movedAddresses,
      movedWallets: result.movedWallets
    }
  })

  const { absorbedPubkey: _dropped, ...publicResult } = result
  return publicResult
}

/**
 * Attaches an UNOWNED pubkey to the account as a secondary identity.
 * A pubkey already belonging to another account must go through the merge
 * flow instead (the route decides which path applies).
 */
export async function linkPubkeyToAccount(
  userId: string,
  pubkey: string,
  label?: string
): Promise<void> {
  try {
    await prisma.nostrIdentity.create({
      data: { pubkey, userId, isPrimary: false, label: label ?? null }
    })
  } catch (err) {
    if ((err as { code?: string } | null)?.code === 'P2002') {
      throw new ConflictError('This pubkey is already linked to an account')
    }
    throw err
  }

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.ACCOUNT_PUBKEY_LINKED,
    message: `Pubkey ${pubkey.slice(0, 8)}… linked as a secondary identity`,
    userId,
    metadata: { pubkey }
  })
}

/**
 * Promotes one of the account's identities to primary (clear-then-set under
 * the partial unique index) and mirrors it onto `User.pubkey`.
 */
export async function setPrimaryIdentity(
  userId: string,
  pubkey: string
): Promise<void> {
  await prisma.$transaction(async tx => {
    const identity = await tx.nostrIdentity.findUnique({ where: { pubkey } })
    if (!identity || identity.userId !== userId) {
      throw new NotFoundError('Identity not found')
    }
    if (identity.isPrimary) return

    await tx.nostrIdentity.updateMany({
      where: { userId, isPrimary: true },
      data: { isPrimary: false }
    })
    await tx.nostrIdentity.update({
      where: { pubkey },
      data: { isPrimary: true }
    })
    await tx.user.update({ where: { id: userId }, data: { pubkey } })
  })

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.ACCOUNT_PRIMARY_CHANGED,
    message: `Primary identity changed to ${pubkey.slice(0, 8)}…`,
    userId,
    metadata: { pubkey }
  })
}

/**
 * Removes a SECONDARY identity from the account. The primary can never be
 * unlinked (change primary first); the last identity can never be unlinked.
 */
export async function unlinkIdentity(
  userId: string,
  pubkey: string
): Promise<void> {
  await prisma.$transaction(async tx => {
    const identity = await tx.nostrIdentity.findUnique({ where: { pubkey } })
    if (!identity || identity.userId !== userId) {
      throw new NotFoundError('Identity not found')
    }
    if (identity.isPrimary) {
      throw new ConflictError(
        'Cannot unlink the primary identity — set another pubkey as primary first'
      )
    }
    const count = await tx.nostrIdentity.count({ where: { userId } })
    if (count <= 1) {
      throw new ConflictError('Cannot unlink the last identity of an account')
    }
    await tx.nostrIdentity.delete({ where: { pubkey } })
  })

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.ACCOUNT_PUBKEY_UNLINKED,
    message: `Pubkey ${pubkey.slice(0, 8)}… unlinked`,
    userId,
    metadata: { pubkey }
  })
}
