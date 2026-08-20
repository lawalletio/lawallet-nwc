import { verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure'
import { normalizeNostrPubkey } from '@/lib/nostr/profile'
import { ValidationError } from '@/types/server/errors'

/**
 * Kind of the coupons-protocol voucher event, signed by the coupon-manager
 * service. It sits in the ephemeral range on purpose: a leaked voucher gets
 * relayed but never stored, and in practice it never reaches a relay at all —
 * it travels inside the mint/claim JSON.
 */
export const VOUCHER_EVENT_KIND = 20402

/** Facts a verified voucher event asserts, preferred over the plain body. */
export interface VerifiedVoucherEvent {
  /** Signer — the coupon-manager service. */
  servicePubkey: string
  /** The merchant that accepts the coupon, from the `p` tag. */
  merchantPubkey: string
  nonce: string
  /** Coupon definition id, from the `coupon` tag. */
  couponId: string | null
  /** From the `expiration` tag, unix seconds. */
  expiresAt: number | null
  /** `minted` or `claimed`, from the `phase` tag. */
  phase: string | null
}

function tagValue(event: NostrEvent, name: string): string | null {
  const tag = event.tags.find(t => t[0] === name)
  return tag?.[1] ?? null
}

/**
 * Verify a deposited kind-20402 event against the deposit it accompanies.
 *
 * Checks run cheap-first, the same order the coupons spec prescribes for its
 * own NIP-98 verification: shape, kind, signature, then the bindings that tie
 * the event to *this* deposit. The signature check is what makes the stored
 * voucher provenance rather than an assertion, so nothing is trusted before
 * it passes.
 *
 * There is deliberately nothing here that binds the voucher to the *recipient*.
 * The coupons protocol has no holder field: `p` is the merchant (the payload
 * calls it `owner`, and the spec's own verification snippet fails it with
 * "different merchant"), and ownership is simply "whoever holds the nonce".
 * The `npub` on a deposit therefore only decides which account we file the row
 * under; it is not, and cannot be, cryptographically bound to the voucher.
 * What actually gates a deposit is the recipient's policy, not this function.
 *
 * @param raw - The event as posted, still untyped.
 * @param expected.merchantPubkey - Hex merchant the caller claims, when it has
 *   one to claim. A transfer learns the merchant *from* the voucher, so it has
 *   nothing to cross-check and omits this.
 * @param expected.nonce - The coupon code the deposit body claims.
 * @param expected.servicePubkey - Hex signer the body claims, when it declared one.
 * @throws ValidationError with a specific reason on any failure.
 */
export function verifyVoucherEvent(
  raw: unknown,
  expected: {
    nonce: string
    merchantPubkey?: string | null
    servicePubkey?: string | null
  }
): VerifiedVoucherEvent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('voucherEvent must be a Nostr event object')
  }
  const event = raw as NostrEvent

  if (event.kind !== VOUCHER_EVENT_KIND) {
    throw new ValidationError(`voucherEvent must be kind ${VOUCHER_EVENT_KIND}`)
  }
  if (!Array.isArray(event.tags) || typeof event.sig !== 'string') {
    throw new ValidationError('voucherEvent is malformed')
  }
  // `verifyEvent` recomputes the id and checks the schnorr signature, so it
  // also catches a tampered tag or content — not just a bad `sig`. It is
  // handed a freshly built object rather than the caller's: nostr-tools
  // memoizes its verdict on the event under a symbol key, and an object that
  // already carries a `true` there short-circuits the check entirely. Nothing
  // arriving as JSON can carry a symbol, but rebuilding from exactly the
  // signed fields costs one object literal and removes the footgun for any
  // future caller that passes an in-memory event.
  const candidate = {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig
  } as NostrEvent
  if (!verifyEvent(candidate)) {
    throw new ValidationError('voucherEvent signature is invalid')
  }

  const merchant = tagValue(event, 'p')
  if (!merchant) {
    throw new ValidationError('voucherEvent has no merchant (`p`) tag')
  }
  if (
    expected.merchantPubkey &&
    merchant.toLowerCase() !== expected.merchantPubkey
  ) {
    throw new ValidationError(
      'voucherEvent names a different merchant than the deposit'
    )
  }

  const nonce = tagValue(event, 'nonce')
  if (!nonce || nonce !== expected.nonce) {
    throw new ValidationError('voucherEvent nonce does not match the deposit')
  }

  const signer = normalizeNostrPubkey(event.pubkey)
  if (!signer) {
    throw new ValidationError('voucherEvent has an invalid signer pubkey')
  }
  if (expected.servicePubkey && signer.pubkey !== expected.servicePubkey) {
    throw new ValidationError(
      'voucherEvent signer does not match servicePubkey'
    )
  }

  const expiration = tagValue(event, 'expiration')
  const expiresAt = expiration ? Number(expiration) : null

  return {
    servicePubkey: signer.pubkey,
    merchantPubkey: merchant.toLowerCase(),
    nonce,
    couponId: tagValue(event, 'coupon'),
    expiresAt: Number.isFinite(expiresAt) && expiresAt ? expiresAt : null,
    phase: tagValue(event, 'phase')
  }
}
