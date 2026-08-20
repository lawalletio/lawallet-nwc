import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthorizationError, ValidationError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateBody } from '@/lib/validation/middleware'
import { depositVoucherSchema } from '@/lib/validation/schemas'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { normalizeNostrPubkey } from '@/lib/nostr/profile'
import { eventBus } from '@/lib/events/event-bus'
import { verifyVoucherEvent } from '@/lib/vouchers/event'
import { assertServiceUrl } from '@/lib/vouchers/url'
import type { Prisma } from '@/lib/generated/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * The single response for both "no such account" and "that sender isn't
 * allowed".
 *
 * Splitting them would turn this endpoint into an npub-existence oracle: any
 * signer could enumerate which community members are registered here by
 * watching for 404-vs-403. One message covers both and stays honest — an npub
 * with no account here genuinely does not accept vouchers from anyone.
 */
const REFUSED = 'Recipient does not accept vouchers from this sender'

/**
 * POST /api/vouchers
 *
 * Public deposit endpoint for the lacrypta/coupons protocol: an external
 * coupon-manager service mints a coupon and assigns it to a member's npub.
 *
 * Authentication is NIP-98 (or a Bearer session), and the signer does **not**
 * need an account on this instance — `resolveRole` falls back to USER for an
 * unknown pubkey. What gates the write is the *recipient's* policy: ANYONE
 * accepts any valid signer, ALLOWLIST accepts only the pubkeys they listed.
 *
 * Idempotent on `(servicePubkey, nonce)`. The protocol is explicit that
 * retries must not look like failures, so a redeposit refreshes the row and
 * returns 200 instead of a conflict.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await rateLimit(request, {
    ...RateLimitPresets.public,
    bucket: 'vouchers-deposit'
  })

  const { pubkey: sender } = await authenticate(request)
  const body = await validateBody(request, depositVoucherSchema)

  const recipient = normalizeNostrPubkey(body.npub)
  if (!recipient) {
    throw new ValidationError('npub is not a valid Nostr public key')
  }
  const merchant = normalizeNostrPubkey(body.merchantPubkey)
  if (!merchant) {
    throw new ValidationError('merchantPubkey is not a valid Nostr public key')
  }
  const declaredService = body.servicePubkey
    ? normalizeNostrPubkey(body.servicePubkey)
    : null
  if (body.servicePubkey && !declaredService) {
    throw new ValidationError('servicePubkey is not a valid Nostr public key')
  }

  // Shape-check the endpoints once here, on the way in, so the refresh path
  // never has to reason about a malformed URL it read back out of the DB.
  assertServiceUrl(body.claimUrl, 'claimUrl')
  if (body.mintUrl) assertServiceUrl(body.mintUrl, 'mintUrl')

  // A linked secondary identity still resolves to the owning account, so a
  // service that only knows an old npub can still deliver.
  const account = await resolveAccountByPubkey(recipient.pubkey)
  if (!account) throw new AuthorizationError(REFUSED)

  const owner = await prisma.user.findUnique({
    where: { id: account.id },
    select: {
      id: true,
      voucherDepositPolicy: true,
      voucherSenderAllowlist: true
    }
  })
  if (!owner) throw new AuthorizationError(REFUSED)
  if (
    owner.voucherDepositPolicy === 'ALLOWLIST' &&
    !owner.voucherSenderAllowlist.includes(sender)
  ) {
    throw new AuthorizationError(REFUSED)
  }

  // A signature beats an assertion: when the CMS-signed event is present its
  // values win over the plain body fields, and mismatches are rejected rather
  // than silently reconciled.
  const verified = body.voucherEvent
    ? verifyVoucherEvent(body.voucherEvent, {
        merchantPubkey: merchant.pubkey,
        nonce: body.nonce,
        servicePubkey: declaredService?.pubkey
      })
    : null

  // With no signed event, the NIP-98 signer *is* the service — that is the
  // only identity we can actually vouch for.
  const servicePubkey =
    verified?.servicePubkey ?? declaredService?.pubkey ?? sender

  const expiresAtSeconds = verified?.expiresAt ?? body.expiresAt ?? null
  const expiresAt = expiresAtSeconds ? new Date(expiresAtSeconds * 1000) : null

  const data = {
    userId: owner.id,
    nonce: verified?.nonce ?? body.nonce,
    couponId: verified?.couponId ?? body.couponId ?? null,
    name: body.name,
    description: body.description ?? null,
    imageUrl: body.image ?? null,
    url: body.url ?? null,
    merchantPubkey: merchant.pubkey,
    servicePubkey,
    claimUrl: body.claimUrl,
    mintUrl: body.mintUrl ?? null,
    metadata: (body.metadata ?? null) as Prisma.InputJsonValue,
    voucherEvent: (body.voucherEvent ?? null) as Prisma.InputJsonValue,
    // A voucher event whose phase already says `claimed` was minted from an
    // ledger that has burned it; recording it as MINTED would show the user a
    // spendable coupon that isn't.
    status: verified?.phase === 'claimed' ? ('CLAIMED' as const) : undefined,
    expiresAt,
    depositedBy: sender
  }

  const existing = await prisma.voucher.findUnique({
    where: { servicePubkey_nonce: { servicePubkey, nonce: data.nonce } },
    select: { id: true }
  })

  const voucher = await prisma.voucher.upsert({
    where: { servicePubkey_nonce: { servicePubkey, nonce: data.nonce } },
    create: data,
    // A redeposit refreshes the presentation fields but never the ownership
    // or the burn state — those are settled by the first deposit and by the
    // status refresh respectively.
    update: {
      name: data.name,
      description: data.description,
      imageUrl: data.imageUrl,
      url: data.url,
      metadata: data.metadata,
      claimUrl: data.claimUrl,
      mintUrl: data.mintUrl,
      expiresAt: data.expiresAt
    },
    select: { id: true, status: true }
  })

  eventBus.emit({ type: 'vouchers:updated', timestamp: Date.now() })

  return NextResponse.json(
    { id: voucher.id, status: voucher.status },
    { status: existing ? 200 : 201 }
  )
})
