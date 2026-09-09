import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateParams } from '@/lib/validation/middleware'
import { voucherIdParam } from '@/lib/validation/schemas'
import { eventBus } from '@/lib/events/event-bus'
import { toVoucherDto, voucherSelect } from '@/lib/vouchers/dto'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Ctx = { params: Promise<{ id: string }> }

/**
 * Load a voucher the caller owns.
 *
 * A voucher owned by someone else is reported as missing rather than
 * forbidden — ids are opaque but guessable in bulk, and a 403 would confirm
 * which ones exist.
 */
async function ownedVoucher(request: Request, ctx: Ctx) {
  const { pubkey } = await authenticate(request)
  const { id } = validateParams(await ctx.params, voucherIdParam)
  const account = await resolveAccountByPubkey(pubkey)
  if (!account) throw new NotFoundError('Voucher not found')

  const voucher = await prisma.voucher.findFirst({
    where: { id, userId: account.id },
    select: voucherSelect
  })
  if (!voucher) throw new NotFoundError('Voucher not found')
  return voucher
}

/** GET /api/wallet/vouchers/[id] — one voucher the caller owns. */
export const GET = withErrorHandling(async (request: Request, ctx: Ctx) => {
  return NextResponse.json(toVoucherDto(await ownedVoucher(request, ctx)))
})

/**
 * DELETE /api/wallet/vouchers/[id]
 *
 * Drop a voucher from the stash. Local only — it does not void the coupon at
 * the service, which stays redeemable by anyone holding the nonce. That is
 * the merchant's call to make, not ours.
 */
export const DELETE = withErrorHandling(async (request: Request, ctx: Ctx) => {
  const voucher = await ownedVoucher(request, ctx)
  await prisma.voucher.delete({ where: { id: voucher.id } })
  eventBus.emit({ type: 'vouchers:updated', timestamp: Date.now() })
  return NextResponse.json({ deleted: true })
})
