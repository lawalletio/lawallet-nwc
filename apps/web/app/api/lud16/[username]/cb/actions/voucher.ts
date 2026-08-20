import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateBody } from '@/lib/validation/middleware'
import { voucherTransferSchema } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
import { verifyVoucherEvent } from '@/lib/vouchers/event'
import { refreshVoucherAtService } from '@/lib/vouchers/status'
import { resolveTransferService } from '@/lib/vouchers/transfer'
import { voucherSelect } from '@/lib/vouchers/dto'
import type { Prisma } from '@/lib/generated/prisma'

/** Bounds how much of a stranger's storage one recipient can be filled with. */
const MAX_OUTSTANDING_TRANSFERS = 100

/** LNURL-shaped refusal. Deliberately uniform — see `refuse` below. */
function refuse(reason: string) {
  return NextResponse.json({ status: 'ERROR', reason }, { status: 200 })
}

/**
 * `POST {callback}` with `action: "voucher"` — take delivery of a coupon.
 *
 * The gate order is the security property, not an implementation detail: no
 * unauthenticated request may reach the network until it has passed rate
 * limiting, schema, recipient policy, and service pinning. Reversed, this
 * endpoint would be a free HTTP proxy that anyone could aim at anything.
 *
 * Refusals are answered `200` with an LNURL `ERROR` body rather than an HTTP
 * error, because that is what LNURL clients parse — and they are kept
 * deliberately vague, since a caller who can distinguish "no such user" from
 * "not accepting" can enumerate the community.
 */
export default async function voucher(
  req: NextRequest,
  username: string
): Promise<NextResponse> {
  await checkRequestLimits(req, 'json')
  // Recipient-scoped first: an attacker rotates IPs freely, but cannot rotate
  // the victim they are trying to fill up.
  await rateLimit(req, {
    ...RateLimitPresets.sensitive,
    bucket: 'voucher-transfer',
    identifier: `voucher-transfer:${username}`
  })

  const body = await validateBody(req, voucherTransferSchema)

  const address = await prisma.lightningAddress.findUnique({
    where: { username },
    select: {
      user: {
        select: {
          id: true,
          allowVouchers: true,
          voucherDepositPolicy: true
        }
      }
    }
  })

  // An ALLOWLIST owner asked to restrict *who* may send them coupons. An LNURL
  // transfer has no authenticated sender, so by definition nobody on the wire
  // is on that list. Reading a self-declared pubkey out of the body instead
  // would make every allowlisted npub spoofable — strictly worse than nothing.
  const recipient = address?.user
  if (
    !recipient ||
    !recipient.allowVouchers ||
    recipient.voucherDepositPolicy === 'ALLOWLIST'
  ) {
    return refuse('This address does not accept vouchers')
  }

  // Integrity, from the signature. Authenticity comes from the pinning below —
  // anyone can sign a flawless voucher for a shop they do not represent.
  let verified
  try {
    verified = verifyVoucherEvent(body.voucher, { nonce: body.nonce })
  } catch {
    return refuse('Voucher signature is invalid')
  }

  const service = await resolveTransferService({
    servicePubkey: verified.servicePubkey,
    userId: recipient.id
  })
  if (!service) {
    return refuse('Unknown coupon service')
  }

  // Replay: the same coupon from the same service is already ours. Answer from
  // the write-ahead row without touching the CMS, so a retried delivery is
  // free and can never burn a second time.
  const existing = await prisma.voucherTransfer.findUnique({
    where: {
      servicePubkey_oldNonce: {
        servicePubkey: verified.servicePubkey,
        oldNonce: body.nonce
      }
    }
  })
  if (existing?.completedAt) {
    return NextResponse.json({ status: 'ACCEPTED' })
  }

  const outstanding = await prisma.voucher.count({
    where: { userId: recipient.id, status: 'MINTED' }
  })
  if (outstanding >= MAX_OUTSTANDING_TRANSFERS) {
    return refuse('Recipient has too many outstanding vouchers')
  }

  // Write the intent BEFORE burning anything. A failed insert means we never
  // call refresh, so a database outage costs nobody their coupon; a row left
  // without `newNonce` is a burn we can replay, because refresh is idempotent
  // on this key.
  const idempotencyKey = existing?.idempotencyKey ?? randomUUID()
  const intent =
    existing ??
    (await prisma.voucherTransfer.create({
      data: {
        userId: recipient.id,
        servicePubkey: verified.servicePubkey,
        oldNonce: body.nonce,
        idempotencyKey
      }
    }))

  let refreshed
  try {
    refreshed = await refreshVoucherAtService({
      refreshUrl: service.refreshUrl,
      nonce: body.nonce,
      idempotencyKey: intent.idempotencyKey
    })
  } catch (err) {
    logger.warn(
      { username, servicePubkey: verified.servicePubkey, err: String(err) },
      'Voucher transfer refresh failed'
    )
    return refuse('Coupon service refused the transfer')
  }

  try {
    const created = await prisma.voucher.create({
      data: {
        userId: recipient.id,
        nonce: refreshed.nonce,
        couponId: refreshed.couponId ?? verified.couponId,
        // The pinned service's own description of the replacement wins. Only
        // if it says nothing do we fall back to a sibling row — never to
        // anything the sender supplied, which they could choose freely.
        name: refreshed.name ?? service.name,
        description: refreshed.description ?? service.description,
        imageUrl: refreshed.image ?? service.imageUrl,
        merchantPubkey: verified.merchantPubkey,
        servicePubkey: verified.servicePubkey,
        claimUrl: service.claimUrl,
        refreshUrl: service.refreshUrl,
        mintUrl: service.mintUrl,
        metadata: (refreshed.benefit
          ? { coupon: refreshed.benefit }
          : service.metadata) as Prisma.InputJsonValue,
        voucherEvent: (refreshed.voucher ??
          body.voucher) as Prisma.InputJsonValue,
        expiresAt: refreshed.expiresAt ?? service.expiresAt,
        // LUD-16 carries no sender identity, and inventing one would be a lie
        // the UI would then render as provenance.
        depositedBy: ''
      },
      select: voucherSelect
    })
    await prisma.voucherTransfer.update({
      where: { id: intent.id },
      data: {
        newNonce: refreshed.nonce,
        voucherId: created.id,
        completedAt: new Date()
      }
    })
  } catch (err) {
    // The burn already happened and we are about to drop the only copy of the
    // replacement. Log it loudly so it is recoverable by hand — there is no
    // way to un-burn, and answering ACCEPTED would strand the coupon silently.
    // ponytail: manual recovery. A reconciler that replays the refresh from
    // the intent row is the upgrade if this ever fires in anger.
    logger.error(
      {
        username,
        transferId: intent.id,
        newNonce: refreshed.nonce,
        err: String(err)
      },
      'Voucher transfer burned at the service but could not be stored'
    )
    return refuse('Could not store the voucher')
  }

  eventBus.emit({ type: 'vouchers:updated', timestamp: Date.now() })
  return NextResponse.json({ status: 'ACCEPTED' })
}
