import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/generated/prisma'
import {
  AuthorizationError,
  ConflictError,
  NotFoundError
} from '@/types/server/errors'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { forgetResolvedAccounts } from '@/lib/auth/account'
import { parseStoredRelays } from '@/lib/nostr/relay-list'
import { isLncurlWalletConfig } from '@/lib/wallet/lncurl-wallet'
import { eventBus } from '@/lib/events/event-bus'
import { reparentAccountResources } from '@/lib/account/reparent'

type Db = Prisma.TransactionClient | typeof prisma

/**
 * `ConflictError.details.reason` when the claimer already has data and has
 * not confirmed merging the recovered account into it. The wallet branches on
 * it to show the merge prompt.
 */
export const RECOVERY_MERGE_REQUIRED = 'RECOVERY_MERGE_REQUIRED'

/** Counts shown side by side in the wallet's merge prompt. */
export interface RecoverySide {
  /** Usernames, primary first. */
  lightningAddresses: string[]
  cards: number
  remoteWallets: number
}

/**
 * What a recovery moved. Persisted on `AccountRecovery.summary` and returned
 * by the claim: drives the claimer's "recovered" dialog and the old owner's
 * transfer notice. Usernames only — routes render `user@domain`.
 */
export interface RecoverySummary {
  /** Usernames, primary first. */
  lightningAddresses: string[]
  primaryAddress: string | null
  cards: { id: string; title: string | null; designImageUrl: string | null }[]
  /** Live (non-revoked, non-dead) wallets, default first. */
  remoteWallets: { id: string; name: string; isDefault: boolean }[]
  vouchers: number
  /** The card that was tapped to mint the recovery QR. */
  recoveredWith: { cardId: string; title: string | null }
}

export interface RecoveryCheck {
  sameAccount: boolean
  mergeRequired: boolean
  existing: RecoverySide
  incoming: RecoverySide
}

const LIVE_WALLET: Prisma.RemoteWalletWhereInput = {
  status: { notIn: ['REVOKED', 'DEAD'] }
}

async function summarizeSide(
  db: Db,
  userId: string | null
): Promise<RecoverySide> {
  if (!userId) return { lightningAddresses: [], cards: 0, remoteWallets: 0 }
  const [addresses, cards, remoteWallets] = await Promise.all([
    db.lightningAddress.findMany({
      where: { userId },
      select: { username: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
    }),
    db.card.count({ where: { userId } }),
    db.remoteWallet.count({ where: { userId, ...LIVE_WALLET } })
  ])
  return {
    lightningAddresses: addresses.map(a => a.username),
    cards,
    remoteWallets
  }
}

/**
 * Whether merging into `userId` would mix two people's data. An auto-minted
 * LNCurl courtesy wallet doesn't count: a freshly signed-up account has one
 * and nothing else.
 */
export async function accountHasData(db: Db, userId: string): Promise<boolean> {
  const [addresses, cards, vouchers, wallets] = await Promise.all([
    db.lightningAddress.count({ where: { userId } }),
    db.card.count({ where: { userId } }),
    db.voucher.count({ where: { userId } }),
    db.remoteWallet.findMany({
      where: { userId, ...LIVE_WALLET },
      select: { config: true }
    })
  ])
  return (
    addresses > 0 ||
    cards > 0 ||
    vouchers > 0 ||
    wallets.some(w => !isLncurlWalletConfig(w.config))
  )
}

async function summarizeForRecovery(
  db: Db,
  userId: string,
  recoveredWith: RecoverySummary['recoveredWith']
): Promise<RecoverySummary> {
  const [addresses, cards, wallets, vouchers] = await Promise.all([
    db.lightningAddress.findMany({
      where: { userId },
      select: { username: true, isPrimary: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }]
    }),
    db.card.findMany({
      where: { userId },
      select: { id: true, title: true, design: { select: { imageUrl: true } } },
      orderBy: { createdAt: 'asc' }
    }),
    db.remoteWallet.findMany({
      where: { userId, ...LIVE_WALLET },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
    }),
    db.voucher.count({ where: { userId } })
  ])
  return {
    lightningAddresses: addresses.map(a => a.username),
    primaryAddress: addresses.find(a => a.isPrimary)?.username ?? null,
    cards: cards.map(c => ({
      id: c.id,
      title: c.title,
      designImageUrl: c.design?.imageUrl ?? null
    })),
    remoteWallets: wallets,
    vouchers,
    recoveredWith
  }
}

interface RecoveryTokenRow {
  id: string
  cardId: string
  purpose: string
  status: string
  expiresAt: Date | null
  recoverFromUserId: string | null
}

/** Shared claimability checks for a RECOVER token; returns the old owner. */
function assertRecoverable(token: RecoveryTokenRow | null): string {
  if (!token || token.purpose !== 'RECOVER' || !token.recoverFromUserId) {
    throw new NotFoundError('Recovery token not found')
  }
  if (token.status === 'CLAIMED') throw new ConflictError('Already claimed')
  if (token.status !== 'PENDING') {
    throw new ConflictError('Recovery QR is no longer valid')
  }
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) {
    throw new ConflictError('Recovery QR has expired')
  }
  return token.recoverFromUserId
}

const TOKEN_SELECT = {
  id: true,
  cardId: true,
  purpose: true,
  status: true,
  expiresAt: true,
  recoverFromUserId: true
} as const

/**
 * Read-only pre-flight for the wallet: is the scanner the card's own owner
 * (just open the wallet), and would recovering mix into an account that
 * already has data (ask first)? `claimerId` is null for a pubkey with no
 * account yet.
 */
export async function getRecoveryCheck(params: {
  tokenId: string
  claimerId: string | null
}): Promise<RecoveryCheck> {
  const token = await prisma.cardActivationToken.findUnique({
    where: { id: params.tokenId },
    select: TOKEN_SELECT
  })
  const fromId = assertRecoverable(token)
  const sameAccount = params.claimerId === fromId

  const [existing, incoming, claimerHasData] = await Promise.all([
    summarizeSide(prisma, params.claimerId),
    summarizeSide(prisma, fromId),
    params.claimerId && !sameAccount
      ? accountHasData(prisma, params.claimerId)
      : Promise.resolve(false)
  ])
  return { sameAccount, mergeRequired: claimerHasData, existing, incoming }
}

/**
 * Read-only pre-check the claim route runs before materialising a brand-new
 * claimer, so a recovery that's bound to fail doesn't leave a signup without
 * its courtesy wallet behind. {@link recoverAccountViaCard} re-checks all of
 * it inside its transaction.
 */
export async function assertRecoveryClaimable(tokenId: string): Promise<void> {
  const token = await prisma.cardActivationToken.findUnique({
    where: { id: tokenId },
    select: TOKEN_SELECT
  })
  const fromId = assertRecoverable(token)
  const card = await prisma.card.findUnique({
    where: { id: token!.cardId },
    select: {
      userId: true,
      blockedAt: true,
      disabledAt: true,
      user: { select: { cardRecoveryEnabled: true } }
    }
  })
  if (!card || card.userId !== fromId) {
    throw new ConflictError(
      'This card changed hands after the recovery QR was printed'
    )
  }
  if (card.blockedAt) throw new ConflictError('This card has been blocked')
  if (card.disabledAt) {
    throw new ConflictError('This card is paused by its owner')
  }
  if (!card.user?.cardRecoveryEnabled) {
    throw new AuthorizationError(
      'The owner turned off card recovery for this account'
    )
  }
}

export type RecoverAccountResult =
  | { outcome: 'same-account'; cardId: string }
  | {
      outcome: 'recovered'
      cardId: string
      recoveryId: string
      fromUserId: string
      mergedIntoExisting: boolean
      summary: RecoverySummary
    }

/**
 * Claims a RECOVER token: every resource of the card holder's account moves
 * onto `claimerId` in one transaction (see {@link reparentAccountResources}).
 *
 * The old account keeps its login material — identities, passkeys, managed
 * key — so it stays a valid, now-empty login that sees the transfer notice.
 * Its connected apps are revoked: they were authorized by the old key.
 * `role` never travels, so an admin's card can't hand out admin rights.
 *
 * Every precondition is re-checked inside the transaction (card still held
 * by the minting-time owner, owner still allows recovery, card not blocked
 * or paused) so a toggle or transfer racing the scan fails closed.
 */
export async function recoverAccountViaCard(params: {
  tokenId: string
  claimerId: string
  confirmMerge?: boolean
}): Promise<RecoverAccountResult> {
  const { tokenId, claimerId, confirmMerge = false } = params

  const result = await prisma.$transaction(async tx => {
    const token = await tx.cardActivationToken.findUnique({
      where: { id: tokenId },
      select: TOKEN_SELECT
    })
    const fromId = assertRecoverable(token)
    const cardId = token!.cardId

    // The card's own owner scanned it: nothing to move. Revoke the QR so a
    // printed ticket isn't left live, and let the wallet just open.
    if (claimerId === fromId) {
      const revoked = await tx.cardActivationToken.updateMany({
        where: { id: tokenId, status: 'PENDING' },
        data: { status: 'REVOKED' }
      })
      if (revoked.count === 0) {
        throw new ConflictError('Recovery QR is no longer valid')
      }
      return { outcome: 'same-account' as const, cardId }
    }

    // Burn first, scoped to PENDING: a concurrent claim loses the race here.
    // Any later throw rolls the burn back with everything else.
    const burn = await tx.cardActivationToken.updateMany({
      where: { id: tokenId, status: 'PENDING' },
      data: {
        status: 'CLAIMED',
        claimedAt: new Date(),
        claimedByUserId: claimerId
      }
    })
    if (burn.count === 0) throw new ConflictError('Already claimed')

    const card = await tx.card.findUnique({
      where: { id: cardId },
      select: { userId: true, title: true, blockedAt: true, disabledAt: true }
    })
    if (!card || card.userId !== fromId) {
      throw new ConflictError(
        'This card changed hands after the recovery QR was printed'
      )
    }
    if (card.blockedAt) {
      throw new ConflictError('This card has been blocked')
    }
    if (card.disabledAt) {
      throw new ConflictError('This card is paused by its owner')
    }

    const accountSelect = {
      id: true,
      pubkey: true,
      relays: true,
      relaysUpdatedAt: true,
      currencyPrefs: true,
      allowVouchers: true,
      voucherDepositPolicy: true,
      voucherSenderAllowlist: true,
      cardRecoveryEnabled: true,
      lightningAddresses: { select: { isPrimary: true } },
      remoteWallets: { select: { id: true, name: true, isDefault: true } }
    } as const
    const [from, to] = await Promise.all([
      tx.user.findUnique({ where: { id: fromId }, select: accountSelect }),
      tx.user.findUnique({ where: { id: claimerId }, select: accountSelect })
    ])
    if (!from || !to) throw new NotFoundError('Account not found')
    if (!from.cardRecoveryEnabled) {
      throw new AuthorizationError(
        'The owner turned off card recovery for this account'
      )
    }

    const mergedIntoExisting = await accountHasData(tx, claimerId)
    if (mergedIntoExisting && !confirmMerge) {
      throw new ConflictError(
        'This account already has data. Confirm the merge to recover into it.',
        { reason: RECOVERY_MERGE_REQUIRED }
      )
    }

    // Snapshot before the move — afterwards it's all under the claimer.
    const summary = await summarizeForRecovery(tx, fromId, {
      cardId,
      title: card.title
    })

    await reparentAccountResources(tx, {
      fromId,
      toId: claimerId,
      target: {
        hasPrimaryAddress: to.lightningAddresses.some(a => a.isPrimary),
        hasDefaultWallet: to.remoteWallets.some(w => w.isDefault)
      },
      incoming: {
        hasPrimaryAddress: from.lightningAddresses.some(a => a.isPrimary),
        wallets: from.remoteWallets
      }
    })

    // The snapshot predates the move, but reparenting can demote the
    // incoming primary address and default wallet and rename a clashing
    // wallet — report those as they ended up.
    const [primary, movedWallets] = await Promise.all([
      tx.lightningAddress.findFirst({
        where: {
          username: { in: summary.lightningAddresses },
          isPrimary: true
        },
        select: { username: true }
      }),
      tx.remoteWallet.findMany({
        where: { id: { in: summary.remoteWallets.map(w => w.id) } },
        select: { id: true, name: true, isDefault: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
      })
    ])
    summary.primaryAddress = primary?.username ?? null
    summary.remoteWallets = movedWallets

    // Settings: a fresh claimer takes the recovered account's as-is; merging
    // into an existing account unions the lists and keeps its own choices.
    const relays = mergedIntoExisting
      ? Array.from(
          new Set([
            ...parseStoredRelays(to.relays),
            ...parseStoredRelays(from.relays)
          ])
        )
      : parseStoredRelays(from.relays)
    const allowlist = mergedIntoExisting
      ? Array.from(
          new Set([
            ...to.voucherSenderAllowlist,
            ...from.voucherSenderAllowlist
          ])
        )
      : from.voucherSenderAllowlist
    await tx.user.update({
      where: { id: claimerId },
      data: {
        ...(relays.length > 0
          ? {
              relays: JSON.stringify(relays),
              relaysUpdatedAt: mergedIntoExisting
                ? new Date()
                : (from.relaysUpdatedAt ?? new Date())
            }
          : {}),
        voucherSenderAllowlist: allowlist,
        ...(mergedIntoExisting
          ? {}
          : {
              allowVouchers: from.allowVouchers,
              voucherDepositPolicy: from.voucherDepositPolicy,
              ...(from.currencyPrefs !== null
                ? { currencyPrefs: from.currencyPrefs as Prisma.InputJsonValue }
                : {})
            })
      }
    })

    // Outstanding QRs on the moved cards were minted for the old holder.
    // Never empty: the tapped card itself is checked to be the old holder's.
    await tx.cardActivationToken.updateMany({
      where: {
        cardId: { in: summary.cards.map(c => c.id) },
        status: 'PENDING'
      },
      data: { status: 'REVOKED' }
    })
    // Connected apps were authorized by the old key, which may be the very
    // thing that was lost.
    await tx.oAuthGrant.updateMany({
      where: { userId: fromId, revokedAt: null },
      data: { revokedAt: new Date() }
    })

    const recovery = await tx.accountRecovery.create({
      data: {
        fromUserId: fromId,
        toUserId: claimerId,
        cardId,
        tokenId,
        summary: summary as unknown as Prisma.InputJsonValue,
        mergedIntoExisting
      },
      select: { id: true }
    })

    return {
      outcome: 'recovered' as const,
      cardId,
      recoveryId: recovery.id,
      fromUserId: fromId,
      mergedIntoExisting,
      summary
    }
  })

  if (result.outcome === 'same-account') return result

  forgetResolvedAccounts()
  const metadata = {
    recoveryId: result.recoveryId,
    cardId: result.cardId,
    tokenId,
    fromUserId: result.fromUserId,
    toUserId: claimerId,
    mergedIntoExisting: result.mergedIntoExisting,
    lightningAddresses: result.summary.lightningAddresses,
    cards: result.summary.cards.length,
    remoteWallets: result.summary.remoteWallets.length
  }
  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.ACCOUNT_RECOVERED,
    level: 'WARN',
    message: `Account recovered via card ${result.cardId}`,
    userId: claimerId,
    metadata
  })
  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.ACCOUNT_TRANSFERRED_OUT,
    level: 'WARN',
    message: `Account transferred out via card ${result.cardId}`,
    userId: result.fromUserId,
    metadata
  })
  eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
  eventBus.emit({ type: 'cards:updated', timestamp: Date.now() })

  return result
}

/** The old owner's open "your account was transferred" notice, if any. */
export interface AccountTransferNotice {
  id: string
  transferredAt: string
  cardTitle: string | null
  lightningAddresses: string[]
  cards: number
  remoteWallets: number
}

export async function getAccountTransferNotice(
  userId: string
): Promise<AccountTransferNotice | null> {
  const row = await prisma.accountRecovery.findFirst({
    where: { fromUserId: userId, noticeDismissedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, summary: true }
  })
  if (!row) return null
  const summary = row.summary as unknown as Partial<RecoverySummary>
  return {
    id: row.id,
    transferredAt: row.createdAt.toISOString(),
    cardTitle: summary.recoveredWith?.title ?? null,
    lightningAddresses: summary.lightningAddresses ?? [],
    cards: summary.cards?.length ?? 0,
    remoteWallets: summary.remoteWallets?.length ?? 0
  }
}

export async function dismissAccountTransferNotices(
  userId: string
): Promise<number> {
  const { count } = await prisma.accountRecovery.updateMany({
    where: { fromUserId: userId, noticeDismissedAt: null },
    data: { noticeDismissedAt: new Date() }
  })
  return count
}

/**
 * Owner opt-out. Turning recovery off also revokes any outstanding RECOVER QR
 * for this account, so a ticket printed a minute ago stops working too.
 */
export async function setCardRecoveryEnabled(
  userId: string,
  enabled: boolean
): Promise<{ enabled: boolean; revokedTokens: number }> {
  const revokedTokens = await prisma.$transaction(async tx => {
    await tx.user.update({
      where: { id: userId },
      data: { cardRecoveryEnabled: enabled }
    })
    if (enabled) return 0
    const { count } = await tx.cardActivationToken.updateMany({
      where: {
        purpose: 'RECOVER',
        recoverFromUserId: userId,
        status: 'PENDING'
      },
      data: { status: 'REVOKED' }
    })
    return count
  })

  logActivity.fireAndForget({
    category: 'USER',
    event: ActivityEvent.CARD_RECOVERY_SETTING_CHANGED,
    level: enabled ? 'INFO' : 'WARN',
    message: `Card recovery ${enabled ? 'enabled' : 'disabled'}`,
    userId,
    metadata: { enabled, revokedTokens }
  })
  eventBus.emit({ type: 'users:updated', timestamp: Date.now() })

  return { enabled, revokedTokens }
}
