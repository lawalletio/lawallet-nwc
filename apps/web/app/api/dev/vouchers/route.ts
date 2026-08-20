import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { assertDevRoutesEnabled } from '@/lib/dev-guard'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { resolveApiUrl } from '@/lib/public-url'
import { eventBus } from '@/lib/events/event-bus'
import { devMintRandom, devServicePubkey } from '@/lib/dev/coupon-service'
import { voucherSelect } from '@/lib/vouchers/dto'
import type { Prisma } from '@/lib/generated/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * `POST /api/dev/vouchers` — drop a random, fully working voucher into the
 * caller's stash.
 *
 * "Working" is the point: it is minted by the in-app dev coupon service, so
 * it carries a real signed kind-20402 and its `claimUrl` / `refreshUrl`
 * resolve — Refresh and Send both function on it, rather than it being a row
 * that only looks right in the list.
 *
 * Authenticated, unlike the other dev routes, because it has to know whose
 * stash to fill. It writes straight to the database instead of going through
 * `POST /api/vouchers`: the deposit endpoint is NIP-98-signed by the sending
 * service, and making a dev button forge that would be more code than the
 * insert it is trying to avoid.
 */
export const POST = withErrorHandling(async (request: Request) => {
  assertDevRoutesEnabled()

  const { pubkey } = await authenticate(request)
  const account = await resolveAccountByPubkey(pubkey)
  if (!account) throw new NotFoundError('User not found')

  const minted = devMintRandom()
  const apiUrl = await resolveApiUrl(request)

  const voucher = await prisma.voucher.create({
    data: {
      userId: account.id,
      nonce: minted.nonce,
      couponId: minted.couponId,
      name: minted.name,
      description: minted.description,
      imageUrl: minted.image,
      merchantPubkey: minted.npub,
      servicePubkey: devServicePubkey(),
      claimUrl: `${apiUrl}/api/dev/coupons/claim`,
      refreshUrl: `${apiUrl}/api/dev/coupons/refresh`,
      metadata: { coupon: minted.coupon } as Prisma.InputJsonValue,
      voucherEvent: JSON.parse(
        JSON.stringify(minted.voucher)
      ) as Prisma.InputJsonValue,
      expiresAt: new Date(minted.expiresAt * 1000),
      depositedBy: devServicePubkey()
    },
    select: voucherSelect
  })

  eventBus.emit({ type: 'vouchers:updated', timestamp: Date.now() })

  return NextResponse.json(
    { id: voucher.id, name: voucher.name },
    { status: 201 }
  )
})
