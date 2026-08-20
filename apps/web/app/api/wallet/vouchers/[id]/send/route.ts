import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError
} from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { sendVoucherSchema, voucherIdParam } from '@/lib/validation/schemas'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { eventBus } from '@/lib/events/event-bus'
import { toVoucherDto, voucherSelect } from '@/lib/vouchers/dto'
import { fetchVoucherStatus } from '@/lib/vouchers/status'
import { deliverVoucher } from '@/lib/vouchers/deliver'
import { nextVoucherStatus } from '@/lib/vouchers/transition'
import type { VoucherStatus } from '@/lib/validation/schemas'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/wallet/vouchers/[id]/send
 *
 * Hand a coupon to a lightning address. The recipient's wallet swaps the nonce
 * at the coupon service to take it; we only learn the outcome.
 *
 * Irreversible by construction, and the ordering reflects that:
 *
 * - `MINTED -> TRANSFER_PENDING` is a **conditional** update, so an honest
 *   double-send cannot start two deliveries of one nonce.
 * - On an explicit refusal we re-read the *service*, not the answer. A
 *   recipient can swap the nonce and then reply `ERROR`, and no ordering fixes
 *   that — the service is the only authority on who holds the coupon now.
 * - The row is never deleted. It is the only record of where the coupon went.
 */
export const POST = withErrorHandling(
  async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
    await checkRequestLimits(request, 'json')
    const { pubkey } = await authenticate(request)
    const { id } = validateParams(await ctx.params, voucherIdParam)
    await rateLimit(request, {
      ...RateLimitPresets.sensitive,
      bucket: 'voucher-send',
      identifier: pubkey
    })

    const body = await validateBody(request, sendVoucherSchema)
    const account = await resolveAccountByPubkey(pubkey)
    if (!account) throw new NotFoundError('Voucher not found')

    const voucher = await prisma.voucher.findFirst({
      where: { id, userId: account.id },
      select: { ...voucherSelect, userId: true }
    })
    if (!voucher) throw new NotFoundError('Voucher not found')
    if (!voucher.refreshUrl) {
      throw new ValidationError(
        'This coupon service does not support transfers'
      )
    }

    // Claim the send. Zero rows means somebody already started one, or the
    // coupon is no longer live — either way this request must not proceed.
    const claimed = await prisma.voucher.updateMany({
      where: { id: voucher.id, status: 'MINTED' },
      data: { status: 'TRANSFER_PENDING' }
    })
    if (claimed.count === 0) {
      throw new ConflictError('This voucher is not available to send')
    }
    eventBus.emit({ type: 'vouchers:updated', timestamp: Date.now() })

    let outcome
    try {
      outcome = await deliverVoucher({
        address: body.address,
        nonce: voucher.nonce,
        voucherEvent: voucher.voucherEvent,
        comment: body.comment
      })
    } catch (err) {
      // Never reached the recipient, or we cannot tell. Leaving the row
      // PENDING would be safe but confusing; the status poller settles it
      // either way, and re-reading the service now is cheap certainty.
      await settleFromService(voucher.id, voucher.claimUrl, voucher.nonce)
      logger.warn(
        { voucherId: voucher.id, err: String(err) },
        'Voucher delivery failed'
      )
      throw err instanceof ServiceUnavailableError
        ? err
        : new ServiceUnavailableError('Could not reach the recipient')
    }

    if (outcome.status !== 'ACCEPTED') {
      // A refusal is not proof we still hold it. Ask the service.
      const settled = await settleFromService(
        voucher.id,
        voucher.claimUrl,
        voucher.nonce
      )
      eventBus.emit({ type: 'vouchers:updated', timestamp: Date.now() })
      throw new ServiceUnavailableError(
        settled === 'TRANSFERRED'
          ? 'The recipient refused it but the coupon has already moved'
          : `Recipient refused the voucher: ${outcome.reason}`
      )
    }

    const updated = await prisma.voucher.update({
      where: { id: voucher.id },
      data: {
        status: 'TRANSFERRED',
        transferredTo: body.address,
        statusCheckedAt: new Date()
      },
      select: voucherSelect
    })
    eventBus.emit({ type: 'vouchers:updated', timestamp: Date.now() })

    return NextResponse.json({ voucher: toVoucherDto(updated) })
  }
)

/**
 * Ask the coupon service what actually happened and write that down.
 *
 * Used on every unhappy path, because the recipient's answer is not evidence:
 * only the service knows whether the nonce is still live. Falls back to
 * MINTED when the service is unreachable — the optimistic answer, but a
 * subsequent refresh will correct it and the alternative (stranding the row in
 * TRANSFER_PENDING on a transient network blip) is worse.
 */
async function settleFromService(
  voucherId: string,
  claimUrl: string,
  nonce: string
): Promise<VoucherStatus> {
  let status: VoucherStatus = 'MINTED'
  try {
    const report = await fetchVoucherStatus({ claimUrl, nonce })
    if (report.status) {
      status = nextVoucherStatus('MINTED', report.status)
    }
  } catch {
    // Unreachable service — fall through to MINTED.
  }
  await prisma.voucher.update({
    where: { id: voucherId },
    data: { status, statusCheckedAt: new Date() }
  })
  return status
}
