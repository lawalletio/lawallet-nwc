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
  cardId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + WRITE_TOKEN_TTL_MS)
  await prisma.card.update({
    where: { id: cardId },
    data: { writeToken: token, writeTokenExpiresAt: expiresAt },
  })
  return { token, expiresAt }
}

/**
 * Validate a presented write token against a card and tell the caller whether
 * it may be honoured. Single-use is enforced by the caller clearing the token
 * after a successful fetch; here we only check it matches, hasn't expired, and
 * that the card is still fresh.
 */
export function isWriteTokenValid(
  card: {
    writeToken: string | null
    writeTokenExpiresAt: Date | null
    lastUsedAt: Date | null
    blockedAt: Date | null
    ntag424: { ctr: number } | null
  },
  presented: string | null | undefined,
): boolean {
  if (!presented || !card.writeToken) return false
  if (presented !== card.writeToken) return false
  if (card.writeTokenExpiresAt && card.writeTokenExpiresAt.getTime() < Date.now()) {
    return false
  }
  return isCardFresh(card)
}
