import type { CardKind } from '@/lib/generated/prisma'

/**
 * Public, non-sensitive card status. Returned by `GET /api/cards/[id]/scan` when
 * the request carries `x-request-action: info` (instead of the LNURL withdraw
 * request), so a tapping client can show the card's identity. Never contains
 * keys, OTC, or SUN params.
 */
export type CardInfo = {
  id: string
  title: string | null
  kind: CardKind
  /** True once the card has an owner (`userId`). */
  paired: boolean
  /** True once the card has been tapped at least once. */
  used: boolean
  /** True once the card's reset keys were exported — decommissioned. */
  blocked: boolean
  /** True when the owner has temporarily paused tap-to-pay. */
  disabled: boolean
  design: { description: string | null; imageUrl: string | null } | null
  /** The owner, when paired. `username` is the primary lightning address if any. */
  user: { pubkey: string; username: string | null } | null
  lastUsedAt: string | null
}

type CardInfoInput = {
  id: string
  title: string | null
  kind: CardKind
  userId: string | null
  lastUsedAt: Date | null
  blockedAt: Date | null
  disabledAt: Date | null
  design: { description: string | null; imageUrl: string | null } | null
  user: { pubkey: string; lightningAddresses?: { username: string }[] } | null
}

/** Projects a loaded card (with `design` + `user.lightningAddresses`) to {@link CardInfo}. */
export function buildCardInfo(card: CardInfoInput): CardInfo {
  return {
    id: card.id,
    title: card.title ?? null,
    kind: card.kind,
    paired: card.userId !== null,
    used: card.lastUsedAt !== null,
    blocked: card.blockedAt !== null,
    disabled: card.disabledAt !== null,
    design: card.design
      ? {
          description: card.design.description ?? null,
          imageUrl: card.design.imageUrl ?? null
        }
      : null,
    user: card.user
      ? {
          pubkey: card.user.pubkey,
          username: card.user.lightningAddresses?.[0]?.username ?? null
        }
      : null,
    lastUsedAt: card.lastUsedAt ? card.lastUsedAt.toISOString() : null
  }
}
