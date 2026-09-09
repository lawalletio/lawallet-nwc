import { randomBytes, randomUUID } from 'node:crypto'
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey
} from 'nostr-tools/pure'
import type { Event as NostrEvent } from 'nostr-tools/pure'
import { VOUCHER_EVENT_KIND } from '@/lib/vouchers/event'

/**
 * A coupon-manager service, in memory, for development only.
 *
 * The real one lives in `lacrypta/merchant`; this exists so the voucher flow
 * — mint, status refresh, and transfer between two local accounts — can be
 * exercised with one click instead of an external process somebody has to
 * remember to start. Every route that touches it is behind
 * `assertDevRoutesEnabled`, so none of this exists in a production build.
 *
 * It implements the parts the wallet actually calls, including the two the
 * spec is fussy about: the burn is conditional (two racing refreshes produce
 * one winner) and `Idempotency-Key` replays the stored response verbatim
 * rather than minting again.
 */

export interface DevMint {
  nonce: string
  couponId: string
  merchantPubkey: string
  status: 'minted' | 'claimed' | 'expired' | 'voided' | 'refreshed'
  expiresAt: number
  claimedAt: number | null
  name: string
  description: string
  image: string | null
  benefit: Record<string, unknown>
  /** Set once burned by a refresh, so a retry can replay it. */
  refreshKey?: string
  refreshResponse?: DevMintResponse
}

export interface DevMintResponse {
  nonce: string
  couponId: string
  name: string
  description: string
  image: string | null
  coupon: Record<string, unknown>
  expiresAt: number
  npub: string
  voucher: NostrEvent
}

interface DevCouponState {
  secretKey: Uint8Array
  mints: Map<string, DevMint>
}

// Cached on `globalThis` for the same reason the Prisma client is: Next's dev
// server re-evaluates modules on every edit, and a plain module-level Map
// would drop every coupon each time a file is saved.
const globalForCoupons = globalThis as unknown as {
  devCouponService?: DevCouponState
}

function state(): DevCouponState {
  if (!globalForCoupons.devCouponService) {
    globalForCoupons.devCouponService = {
      secretKey: generateSecretKey(),
      mints: new Map()
    }
  }
  return globalForCoupons.devCouponService
}

export function devServicePubkey(): string {
  return getPublicKey(state().secretKey)
}

/** 22 chars of base64url, the length the protocol pins. */
function newNonce(): string {
  return randomBytes(16).toString('base64url')
}

function signVoucher(mint: DevMint): NostrEvent {
  return finalizeEvent(
    {
      kind: VOUCHER_EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['nonce', mint.nonce],
        // `p` is the merchant. Not the holder — the protocol has none.
        ['p', mint.merchantPubkey],
        ['coupon', mint.couponId],
        ['phase', 'minted'],
        ['expiration', String(mint.expiresAt)]
      ],
      content: JSON.stringify({
        v: 1,
        nonce: mint.nonce,
        owner: mint.merchantPubkey,
        name: mint.name,
        description: mint.description,
        coupon: mint.benefit,
        phase: 'minted'
      })
    },
    state().secretKey
  )
}

function toResponse(mint: DevMint): DevMintResponse {
  return {
    nonce: mint.nonce,
    couponId: mint.couponId,
    name: mint.name,
    description: mint.description,
    image: mint.image,
    coupon: mint.benefit,
    expiresAt: mint.expiresAt,
    npub: mint.merchantPubkey,
    voucher: signVoucher(mint)
  }
}

export function devMint(
  input: Omit<DevMint, 'nonce' | 'couponId' | 'status' | 'claimedAt'>
): DevMintResponse {
  const mint: DevMint = {
    ...input,
    nonce: newNonce(),
    couponId: randomUUID(),
    status: 'minted',
    claimedAt: null
  }
  state().mints.set(mint.nonce, mint)
  return toResponse(mint)
}

export function devPreview(nonce: string): DevMint | null {
  return state().mints.get(nonce) ?? null
}

export type DevRefreshResult =
  | { ok: true; replayed: boolean; response: DevMintResponse }
  | { ok: false; status: number; reason: string }

/**
 * Burn a nonce and mint its replacement, preserving the benefit snapshot and
 * the expiry. Refresh is not an expiry extension, and re-deriving the benefit
 * would break freeze-at-mint.
 */
export function devRefresh(
  nonce: string,
  idempotencyKey: string
): DevRefreshResult {
  const mints = state().mints
  const row = mints.get(nonce)
  if (!row) return { ok: false, status: 404, reason: 'Unknown nonce' }

  // Replay is checked before the burn test: a retry must not look like a race.
  if (row.status === 'refreshed') {
    if (row.refreshKey === idempotencyKey && row.refreshResponse) {
      return { ok: true, replayed: true, response: row.refreshResponse }
    }
    return { ok: false, status: 409, reason: 'Already refreshed' }
  }
  if (row.status !== 'minted') {
    return {
      ok: false,
      status: 409,
      reason: `Cannot refresh a ${row.status} coupon`
    }
  }
  if (row.expiresAt * 1000 <= Date.now()) {
    return { ok: false, status: 410, reason: 'Coupon has expired' }
  }

  const replacement: DevMint = {
    ...row,
    nonce: newNonce(),
    status: 'minted',
    refreshKey: undefined,
    refreshResponse: undefined
  }
  const response = toResponse(replacement)
  mints.set(replacement.nonce, replacement)
  // Store the response verbatim: a replay must return the same event id, or a
  // receiver that persisted the first one holds provenance that no longer
  // matches.
  mints.set(nonce, {
    ...row,
    status: 'refreshed',
    refreshKey: idempotencyKey,
    refreshResponse: response
  })
  return { ok: true, replayed: false, response }
}

// ── Random coupon generator ─────────────────────────────────────────────────

const CATALOG: Array<{
  name: string
  description: string
  image: string | null
  benefit: Record<string, unknown>
  days: number
}> = [
  {
    name: '20% off any coffee',
    description: 'Any single drink. Dine-in only.',
    image: 'https://placehold.co/600x400/6d28d9/ffffff?text=Coffee',
    benefit: { type: 'percent', percent: 20 },
    days: 30
  },
  {
    name: '3x2 on empanadas',
    description: 'Mix and match any flavour.',
    image: 'https://placehold.co/600x400/047857/ffffff?text=3x2',
    benefit: {
      type: 'multibuy',
      buyQty: 3,
      payQty: 2,
      cap: { amount: 5000, currency: 'SAT' }
    },
    days: 14
  },
  {
    name: '$500 off your bill',
    description: 'Minimum spend $2000.',
    image: 'https://placehold.co/600x400/b45309/ffffff?text=%24500',
    benefit: { type: 'fixed', amount: 500, currency: 'ARS' },
    days: 7
  },
  {
    name: 'Free croissant',
    description: 'One butter croissant with any hot drink.',
    image: 'https://placehold.co/600x400/be123c/ffffff?text=Croissant',
    benefit: { type: 'freeItems', items: [{ d: 'croissant', qty: 1 }] },
    days: 60
  },
  {
    name: 'Buy a pizza, get a beer',
    description: 'Any large pizza. Draft only.',
    image: 'https://placehold.co/600x400/0f766e/ffffff?text=Pizza',
    benefit: {
      type: 'buyXgetY',
      buyProductD: 'pizza-lg',
      giftProductD: 'beer-500'
    },
    days: 21
  },
  {
    name: '50% off, capped',
    description: 'Half price, up to 10,000 sats.',
    image: 'https://placehold.co/600x400/7c2d12/ffffff?text=50%25',
    benefit: {
      type: 'percent',
      percent: 50,
      cap: { amount: 10000, currency: 'SAT' }
    },
    days: 3
  },
  {
    name: '10 USD off electronics',
    description: 'Accessories aisle only.',
    image: 'https://placehold.co/600x400/1d4ed8/ffffff?text=%2410',
    benefit: {
      type: 'fixed',
      amount: 10,
      currency: 'USD',
      productDs: ['accessories']
    },
    days: 90
  },
  // No image and an unrecognised benefit type — the fallback rendering needs
  // to be reachable from the button too, not only from a hand-crafted deposit.
  {
    name: 'Mystery perk',
    description: 'Terms defined by the merchant.',
    image: null,
    benefit: { type: 'quantumDiscount', entangled: true },
    days: 10
  }
]

/** Mint a random plausible coupon. Merchant differs per call, as in real life. */
export function devMintRandom(): DevMintResponse {
  const pick = CATALOG[Math.floor(Math.random() * CATALOG.length)]
  return devMint({
    merchantPubkey: getPublicKey(generateSecretKey()),
    name: pick.name,
    description: pick.description,
    image: pick.image,
    benefit: pick.benefit,
    expiresAt: Math.floor(Date.now() / 1000) + pick.days * 86_400
  })
}
