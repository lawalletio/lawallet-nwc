import { prisma } from '@/lib/prisma'
import { ConflictError } from '@/types/server/errors'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import {
  toWalletAddressDto,
  type WalletAddressDto,
  type WalletAddressMode
} from '@/lib/wallet/wallet-address-dto'
import { resolveDefaultAddressRouting } from '@/lib/wallet/default-address-mode'
import {
  derivePrimaryWallet,
  findInitialPrimaryWalletCandidate,
  getPrimaryRemoteWalletForUser,
  syncPrimaryRemoteWalletFlag
} from '@/lib/wallet/primary-wallet'

export interface CreateLightningAddressParams {
  /** Account the address belongs to. */
  userId: string
  username: string
  /** Only honoured for non-primary addresses; the first one derives its own. */
  mode?: WalletAddressMode
  /**
   * Pubkey of the admin/operator who provisioned this on someone else's
   * behalf. Recorded in the activity log so the action is auditable; absent
   * for ordinary self-service creation.
   */
  provisionedBy?: string
}

/**
 * Creates a lightning address for `userId`.
 *
 * Shared by self-service creation (`POST /api/wallet/addresses`) and operator
 * provisioning (`POST /api/lightning-addresses`). It deliberately enforces
 * **no** registration policy — callers decide: self-service runs
 * `requireAddressRegistration` first, provisioning bypasses it because the
 * operator is acting out-of-band.
 *
 * @throws {ConflictError} When the username is already taken.
 */
export async function createLightningAddressForUser({
  userId,
  username,
  mode,
  provisionedBy
}: CreateLightningAddressParams): Promise<WalletAddressDto> {
  const existing = await prisma.lightningAddress.findUnique({
    where: { username }
  })
  if (existing) throw new ConflictError('Username is already taken')

  // A user's first/only address becomes their primary automatically — nobody
  // should end up with a single, non-primary address. Subsequent adds never
  // touch the existing primary. The DB's partial-unique index (one primary per
  // userId) makes this safe: when the count is 0 there's no primary to clash.
  const ownedCount = await prisma.lightningAddress.count({
    where: { userId }
  })
  const isPrimary = ownedCount === 0

  let created
  try {
    created = await prisma.$transaction(async tx => {
      const primaryCandidate = isPrimary
        ? await findInitialPrimaryWalletCandidate(userId, tx)
        : null
      // A non-primary address with no explicit mode inherits the primary
      // wallet as its own binding, so it routes immediately without depending
      // on the primary staying put.
      const fallback = isPrimary
        ? null
        : await resolveDefaultAddressRouting(userId)
      const nextMode = isPrimary
        ? primaryCandidate
          ? 'CUSTOM_NWC'
          : 'IDLE'
        : (mode ?? fallback!.mode)
      const boundWalletId = isPrimary
        ? (primaryCandidate?.id ?? null)
        : nextMode === 'CUSTOM_NWC'
          ? (fallback?.remoteWalletId ?? null)
          : null

      const address = await tx.lightningAddress.create({
        data: {
          username,
          userId,
          mode: nextMode,
          remoteWalletId: boundWalletId,
          isPrimary
        },
        include: { remoteWallet: true }
      })

      if (isPrimary) {
        await syncPrimaryRemoteWalletFlag(userId, tx)
      }

      return address
    })
  } catch (error) {
    // Two concurrent creates both clear the pre-check above and race to the
    // insert; the unique index rejects the loser. Surface it as the same 409
    // the pre-check produces rather than a 500.
    if (
      error &&
      typeof error === 'object' &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw new ConflictError('Username is already taken')
    }
    throw error
  }

  const defaultWallet = isPrimary
    ? derivePrimaryWallet(created)
    : await getPrimaryRemoteWalletForUser(userId)

  eventBus.emit({ type: 'addresses:updated', timestamp: Date.now() })
  // Also bump users:updated so any mounted /api/users/me consumer (e.g.
  // the admin home banner that nudges to register a first address) drops
  // its now-stale state.
  eventBus.emit({ type: 'users:updated', timestamp: Date.now() })
  logActivity.fireAndForget({
    category: 'ADDRESS',
    event: ActivityEvent.ADDRESS_CREATED,
    message: provisionedBy
      ? `Lightning address provisioned: ${created.username}`
      : `Lightning address created: ${created.username}`,
    userId,
    metadata: {
      username: created.username,
      mode: created.mode,
      ...(provisionedBy ? { provisionedBy } : {})
    }
  })

  return toWalletAddressDto(created, defaultWallet)
}
