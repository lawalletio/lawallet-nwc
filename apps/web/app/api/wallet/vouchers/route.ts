import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateQuery } from '@/lib/validation/middleware'
import { voucherListQuerySchema } from '@/lib/validation/schemas'
import { toVoucherDto, voucherSelect } from '@/lib/vouchers/dto'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/wallet/vouchers
 *
 * The authenticated caller's own voucher stash. Owner-scoped, so any role can
 * call it — the `/admin/vouchers` page a plain USER sees reads this, the same
 * way `/admin/addresses` reads `/api/wallet/addresses`.
 */
export const GET = withErrorHandling(async (request: Request) => {
  const { pubkey } = await authenticate(request)
  const account = await resolveAccountByPubkey(pubkey)
  if (!account) throw new NotFoundError('User not found')

  const { status } = validateQuery(request.url, voucherListQuerySchema)

  const vouchers = await prisma.voucher.findMany({
    where: { userId: account.id, ...(status ? { status } : {}) },
    select: voucherSelect,
    orderBy: { createdAt: 'desc' }
  })

  return NextResponse.json(vouchers.map(toVoucherDto))
})
