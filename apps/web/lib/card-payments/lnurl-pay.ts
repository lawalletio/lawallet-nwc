import type { LightningAddressMode } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { derivePrimaryWallet } from '@/lib/wallet/primary-wallet'
import {
  resolveCardWallet,
  type CardWalletRoute,
  type RemoteWalletRef
} from '@/lib/wallet/resolve-payment-route'

/**
 * BoltCard LUD-19 top-up.
 *
 * A configured card scan advertises `payLink` as a raw LUD-17 `lnurlp://` URL
 * (not bech32). Following it returns a LUD-06 payRequest whose callback mints
 * a BOLT11 invoice on the RemoteWallet the card spends from — the card's bound
 * wallet, or the owner's primary-address wallet when the card has no explicit
 * binding. It never points at the owner's LUD-16 address.
 *
 * Specs:
 * - LUD-19: https://github.com/lnurl/luds/blob/luds/19.md
 * - LUD-17: https://github.com/lnurl/luds/blob/luds/17.md
 * - BoltCard SPEC (optional LUD-19): https://github.com/boltcard/boltcard/blob/main/docs/SPEC.md
 */

/** Same millisatoshi bounds the LUD-16 payRequest advertises (1 sat … 1_000_000 sats). */
export const CARD_LNURLP_MIN_SENDABLE_MSATS = 1000
export const CARD_LNURLP_MAX_SENDABLE_MSATS = 1_000_000_000

const WALLET_SELECT = {
  id: true,
  type: true,
  config: true,
  status: true
} as const

export const cardLnurlPaySelect = {
  id: true,
  userId: true,
  blockedAt: true,
  disabledAt: true,
  remoteWallet: { select: WALLET_SELECT },
  user: {
    select: {
      id: true,
      lightningAddresses: {
        where: { isPrimary: true },
        take: 1,
        select: {
          mode: true,
          remoteWalletId: true,
          remoteWallet: { select: WALLET_SELECT }
        }
      }
    }
  }
} as const

type AddressWallet = {
  mode: LightningAddressMode
  remoteWalletId: string | null
  remoteWallet: RemoteWalletRef | null
}

export interface CardReceiveInput {
  blockedAt: Date | null
  disabledAt: Date | null
  remoteWallet: RemoteWalletRef | null
  user: { lightningAddresses?: AddressWallet[] } | null
}

export type CardReceiveDecision =
  | { ok: true; route: Extract<CardWalletRoute, { kind: 'wallet' }> }
  | { ok: false; reason: string }

/**
 * Refusal for a card that already has a routing decision.
 *
 * Unpaired, blocked, disabled, and cards with no receivable wallet refuse.
 * Spend capability is irrelevant: a receive-only wallet can still be topped up.
 */
export function cardReceiveRefusal(
  card: Pick<CardReceiveInput, 'user' | 'blockedAt' | 'disabledAt'>,
  route: CardWalletRoute
): string | null {
  if (!card.user) return 'Card is not paired'
  if (card.blockedAt) return 'Card is blocked'
  if (card.disabledAt) return 'Card is disabled'
  if (route.kind !== 'wallet') {
    return 'Card is not configured to receive payments'
  }
  return null
}

/**
 * Whether a card may advertise (and serve) a LUD-19 pay link.
 * Cheap state is checked before the wallet decrypt so a blocked card never
 * opens the vault.
 */
export function decideCardReceive(card: CardReceiveInput): CardReceiveDecision {
  if (!card.user) return { ok: false, reason: 'Card is not paired' }
  if (card.blockedAt) return { ok: false, reason: 'Card is blocked' }
  if (card.disabledAt) return { ok: false, reason: 'Card is disabled' }

  const route = resolveCardWallet({
    remoteWallet: card.remoteWallet,
    defaultRemoteWallet: derivePrimaryWallet(card.user.lightningAddresses?.[0])
  })
  // Unpaired, blocked, and disabled already returned above. The only refusal
  // left is a route with nothing to invoice.
  if (route.kind !== 'wallet') {
    return {
      ok: false,
      reason: 'Card is not configured to receive payments'
    }
  }
  return { ok: true, route }
}

/**
 * LUD-17 raw pay URL. Replaces the https scheme with `lnurlp` and keeps the
 * host (including port), path, and query. Not bech32.
 */
export function lud17PayLink(httpsUrl: string): string {
  const url = new URL(httpsUrl)
  return `lnurlp://${url.host}${url.pathname}${url.search}`
}

export function cardLnurlPayHttpsUrl(apiUrl: string, cardId: string): string {
  return `${apiUrl}/api/cards/${cardId}/lnurlp`
}

export function cardLnurlPayCallbackUrl(
  apiUrl: string,
  cardId: string
): string {
  return `${apiUrl}/api/cards/${cardId}/lnurlp/cb`
}

/**
 * `payLink` for a scan that already resolved `route` for the spend path.
 * Returns `undefined` when the card cannot receive — the key is omitted.
 */
export function cardScanPayLink(
  apiUrl: string,
  cardId: string,
  card: CardReceiveInput,
  route: CardWalletRoute
): string | undefined {
  if (cardReceiveRefusal(card, route)) return undefined
  return lud17PayLink(cardLnurlPayHttpsUrl(apiUrl, cardId))
}

/** LUD-06 metadata string. Stable so wallets can hash it. */
export function cardLnurlPayMetadata(): string {
  return JSON.stringify([['text/plain', 'BoltCard top-up']])
}

export function loadCardForLnurlPay(cardId: string) {
  return prisma.card.findUnique({
    where: { id: cardId },
    select: cardLnurlPaySelect
  })
}
