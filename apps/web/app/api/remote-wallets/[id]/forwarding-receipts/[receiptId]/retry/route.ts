import { after } from 'next/server'
import { NextResponse } from 'next/server'
import {
  remoteWalletForwardReceiptParamsSchema,
  remoteWalletForwardRetrySchema
} from '@lawallet-nwc/shared'
import { requireUserId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { prisma } from '@/lib/prisma'
import { reconcileRemoteWalletForwarding } from '@/lib/remote-wallet-forwarding/reconcile'
import { emitForwardingUpdated } from '@/lib/remote-wallet-forwarding/service'
import { loadOwnedRemoteWallet } from '@/lib/remote-wallets/owned'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import {
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import { withErrorHandling } from '@/types/server/error-handler'

export const POST = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; receiptId: string }> }
  ) => {
    await checkRequestLimits(request, 'json')
    const userId = await requireUserId(request)
    const { id, receiptId } = validateParams(
      await params,
      remoteWalletForwardReceiptParamsSchema
    )
    const body = await validateBody(request, remoteWalletForwardRetrySchema)
    await loadOwnedRemoteWallet(id, userId)
    const receipt = await prisma.remoteWalletForwardReceipt.findFirst({
      where: { id: receiptId, walletId: id, userId },
      include: { action: { select: { enabled: true } } }
    })
    if (!receipt) throw new NotFoundError('Forwarding receipt not found')
    if (!receipt.action.enabled) {
      throw new ConflictError('Resume forwarding before retrying a receipt')
    }
    // A leg already READY needs no retry; counting it would make the
    // "nothing to retry" branch unreachable and report work that never happened.
    const result = await prisma.remoteWalletForwardLeg.updateMany({
      where: {
        receiptId,
        status: { in: ['REJECTED', 'EXPIRED'] },
        ...(body.legIds?.length ? { id: { in: body.legIds } } : {})
      },
      data: { status: 'READY', nextRetryAt: new Date(), lastError: null }
    })
    const rescheduled = await prisma.remoteWalletForwardLeg.updateMany({
      where: {
        receiptId,
        status: 'READY',
        nextRetryAt: { gt: new Date() },
        ...(body.legIds?.length ? { id: { in: body.legIds } } : {})
      },
      data: { nextRetryAt: new Date() }
    })
    const retryingLegs = result.count + rescheduled.count
    if (retryingLegs === 0) {
      throw new ConflictError(
        'No safely retryable forwarding legs were selected'
      )
    }
    await prisma.remoteWalletForwardReceipt.update({
      where: { id: receiptId },
      data: {
        status:
          receipt.forwardedAmountMsats > BigInt(0) ? 'PARTIAL' : 'FORWARDING',
        nextRetryAt: new Date(),
        lastError: null
      }
    })
    emitForwardingUpdated()
    after(() => reconcileRemoteWalletForwarding({ ids: [receiptId] }))
    return NextResponse.json(
      { accepted: true, retryingLegs },
      { status: 202 }
    )
  }
)
