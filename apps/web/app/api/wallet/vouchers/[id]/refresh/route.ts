import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateParams } from '@/lib/validation/middleware'
import { voucherIdParam } from '@/lib/validation/schemas'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { eventBus } from '@/lib/events/event-bus'
import { toVoucherDto, voucherSelect } from '@/lib/vouchers/dto'
import { fetchVoucherStatus } from '@/lib/vouchers/status'
import {
  isTerminalVoucherStatus,
  nextVoucherStatus
} from '@/lib/vouchers/transition'
import type { VoucherStatus } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Minimum gap between two live polls of the same voucher. This endpoint makes
 * *us* generate traffic against a third-party service on a button press, so
 * the cooldown is about being a good citizen upstream, not about protecting
 * this instance — the rate limiter already does that.
 */
const REFRESH_COOLDOWN_MS = 30_000

/**
 * POST /api/wallet/vouchers/[id]/refresh
 *
 * Re-read a voucher's status from its coupon-manager service and persist the
 * result. Returns the voucher either way, so the client can render the
 * (possibly unchanged) row without a second request.
 *
 * Two short-circuits before any network call: a voucher already in a terminal
 * state can never change, and one polled seconds ago will not have.
 */
export const POST = withErrorHandling(
  async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { pubkey } = await authenticate(request)
    const { id } = validateParams(await ctx.params, voucherIdParam)
    await rateLimit(request, {
      ...RateLimitPresets.sensitive,
      bucket: 'voucher-refresh',
      identifier: pubkey
    })

    const account = await resolveAccountByPubkey(pubkey)
    if (!account) throw new NotFoundError('Voucher not found')

    const voucher = await prisma.voucher.findFirst({
      where: { id, userId: account.id },
      select: voucherSelect
    })
    if (!voucher) throw new NotFoundError('Voucher not found')

    const cooling =
      voucher.statusCheckedAt !== null &&
      Date.now() - voucher.statusCheckedAt.getTime() < REFRESH_COOLDOWN_MS

    if (isTerminalVoucherStatus(voucher.status as VoucherStatus) || cooling) {
      return NextResponse.json({
        voucher: toVoucherDto(voucher),
        checked: false
      })
    }

    const report = await fetchVoucherStatus({
      claimUrl: voucher.claimUrl,
      nonce: voucher.nonce
    })
    // A status this build doesn't recognise leaves the row alone. We still
    // stamp `statusCheckedAt` below, so the cooldown applies and we don't
    // hammer a service that is simply newer than we are.
    const status =
      report.status === null
        ? (voucher.status as VoucherStatus)
        : nextVoucherStatus(voucher.status as VoucherStatus, report.status)

    const updated = await prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        status,
        statusCheckedAt: new Date(),
        // Only ever *set* a claim time. A service that reports `claimed` with
        // no timestamp still burned the coupon, so fall back to now rather
        // than leaving the row looking unredeemed.
        claimedAt:
          status === 'CLAIMED'
            ? (voucher.claimedAt ?? report.claimedAt ?? new Date())
            : voucher.claimedAt,
        expiresAt: report.expiresAt ?? voucher.expiresAt
      },
      select: voucherSelect
    })

    if (updated.status !== voucher.status) {
      eventBus.emit({ type: 'vouchers:updated', timestamp: Date.now() })
    }

    return NextResponse.json({
      voucher: toVoucherDto(updated),
      checked: true
    })
  }
)
