import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'

/**
 * The BoltCard programming QR (`GET /api/cards/[id]/write`) hands out the
 * NTAG424 keys so a writer device can program a fresh card. To stop that URL
 * from being replayed to re-extract the keys, the writer must carry a one-time
 * token minted here. The token is single-use (consumed by the first `/write`
 * fetch) and bounded by a short TTL, and is only ever minted while the card is
 * still "fresh" — i.e. it has never been tapped.
 */
export const WRITE_TOKEN_TTL_MS = 15 * 60 * 1000 // 15 minutes

/**
 * A card may only be (re)programmed while it has never been tapped. The first
 * tap advances the NTAG424 counter and stamps `lastUsedAt` (see
 * `scan/cb/route.ts`), after which the keys must stay locked — exporting them
 * for a card already in the wild would let it be cloned.
 */
export function isCardFresh(card: {
  lastUsedAt: Date | null
  blockedAt: Date | null
  ntag424: { ctr: number } | null
}): boolean {
  return (
    card.lastUsedAt === null &&
    card.blockedAt === null &&
    (card.ntag424?.ctr ?? 0) === 0
  )
}

/**
 * Mint a fresh single-use write token for a card, replacing any outstanding
 * one (so re-opening the modal always yields a unique URL and invalidates the
 * previous QR). Callers MUST verify {@link isCardFresh} first.
 */
export async function mintWriteToken(
  cardId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + WRITE_TOKEN_TTL_MS)
  await prisma.card.update({
    where: { id: cardId },
    data: { writeToken: token, writeTokenExpiresAt: expiresAt }
  })
  return { token, expiresAt }
}

/**
 * Validate a presented write token against a card snapshot and tell the caller
 * whether the token *appears* valid. This is a NON-LOCKING pre-check against an
 * in-memory snapshot: it rejects missing/mismatched/expired tokens and cards
 * that are no longer fresh (tapped/blocked) up front, but it does NOT enforce
 * single-use — two concurrent requests can read the same snapshot and both
 * pass.
 *
 * Callers MUST enforce single-use themselves with an atomic compare-and-consume
 * inside the same transaction that exports the keys: a conditional
 * `card.updateMany` whose `where` re-asserts `writeToken`, `writeTokenExpiresAt`
 * (`gt: now`), `lastUsedAt: null` and `blockedAt: null`, rejecting on
 * `count === 0` (a concurrent consumer already nulled `writeToken`). See
 * `app/api/cards/[id]/write/route.ts` for the canonical implementation.
 */
export function isWriteTokenValid(
  card: {
    writeToken: string | null
    writeTokenExpiresAt: Date | null
    lastUsedAt: Date | null
    blockedAt: Date | null
    ntag424: { ctr: number } | null
  },
  presented: string | null | undefined
): boolean {
  if (!presented || !card.writeToken) return false
  if (presented !== card.writeToken) return false
  if (
    card.writeTokenExpiresAt &&
    card.writeTokenExpiresAt.getTime() < Date.now()
  ) {
    return false
  }
  return isCardFresh(card)
}
