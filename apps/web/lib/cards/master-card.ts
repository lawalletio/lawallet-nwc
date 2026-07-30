import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/lib/generated/prisma'

type PrismaLike = typeof prisma | Prisma.TransactionClient

/**
 * A holder's MASTER card is their account-recovery card — at most one per
 * holder, enforced by the `Card_userId_master_unique` partial index.
 *
 * Every promotion goes through `setMasterCard`, which demotes the previous
 * master *first*. That ordering is mandatory, not stylistic: Postgres checks
 * the partial unique index mid-transaction, so promoting before demoting
 * trips the constraint even though the end state would be valid. Same reason
 * the primary-address route (`app/api/wallet/addresses/[username]/primary`)
 * is written as clear-then-set rather than a single updateMany.
 *
 * The designation never travels with the card: every path that changes a
 * card's holder resets `kind` to SIMPLE (claim, OTC activate, unpairCard).
 * MASTER is a decision about an *account*, so only the holder — or an admin
 * acting on their behalf — can make it, on a card they already own.
 *
 * Only the *designation* lives here. The recovery mechanism it's meant to
 * unlock (FOREVER share QRs, CardClaim, LightningAddressShare /
 * RemoteWalletShare) is still deferred — see docs/roadmap/MONTH-6.md.
 */

/** Id of the holder's current MASTER card, or null when they have none. */
export async function getMasterCardId(
  userId: string,
  client: PrismaLike = prisma
): Promise<string | null> {
  const master = await client.card.findFirst({
    where: { userId, kind: 'MASTER' },
    select: { id: true }
  })
  return master?.id ?? null
}

/**
 * Strip the MASTER designation from every card the holder owns except
 * `exceptCardId` — making room *before* a promotion, since the partial unique
 * index rejects the intermediate state where two rows are MASTER.
 */
async function demoteOtherMasterCards(
  userId: string,
  exceptCardId: string,
  client: PrismaLike = prisma
): Promise<void> {
  await client.card.updateMany({
    where: { userId, kind: 'MASTER', id: { not: exceptCardId } },
    data: { kind: 'SIMPLE' }
  })
}

/**
 * Make `cardId` the holder's MASTER card, demoting whichever card held the
 * designation before. Returns the demoted card's id, or null when there was
 * none (or when `cardId` was already the master — an idempotent no-op).
 *
 * Caller is responsible for having verified that `cardId` belongs to `userId`
 * and is eligible (paired, not blocked).
 */
export async function setMasterCard(
  userId: string,
  cardId: string,
  client: PrismaLike = prisma
): Promise<{ previousMasterCardId: string | null }> {
  const previousMasterCardId = await getMasterCardId(userId, client)
  if (previousMasterCardId === cardId) {
    return { previousMasterCardId: null }
  }

  // Demote first — the partial unique index is checked mid-transaction.
  await demoteOtherMasterCards(userId, cardId, client)
  await client.card.update({
    where: { id: cardId },
    data: { kind: 'MASTER' }
  })

  return { previousMasterCardId }
}

/**
 * Drop the MASTER designation from `cardId`, leaving the holder with none.
 * Idempotent — a card that is already SIMPLE is left untouched.
 */
export async function clearMasterCard(
  cardId: string,
  client: PrismaLike = prisma
): Promise<void> {
  await client.card.updateMany({
    where: { id: cardId, kind: 'MASTER' },
    data: { kind: 'SIMPLE' }
  })
}
