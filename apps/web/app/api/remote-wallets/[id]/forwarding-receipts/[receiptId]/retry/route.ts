import { after } from 'next/server'
import { NextResponse } from 'next/server'
import {
  remoteWalletForwardReceiptParamsSchema,
  remoteWalletForwardRetrySchema
} from '@lawallet-nwc/shared'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountId } from '@/lib/auth/account'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { prisma } from '@/lib/prisma'
import { reconcileRemoteWalletForwarding } from '@/lib/remote-wallet-forwarding/reconcile'
import {
  emitForwardingUpdated,
  loadOwnedRemoteWallet
} from '@/lib/remote-wallet-forwarding/service'
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
    const auth = await authenticate(request)
    const userId = await resolveAccountId(auth.pubkey)
    if (!userId) throw new NotFoundError('User not found')
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
    const result = await prisma.remoteWalletForwardLeg.updateMany({
      where: {
        receiptId,
        status: { in: ['READY', 'REJECTED', 'EXPIRED'] },
        ...(body.legIds?.length ? { id: { in: body.legIds } } : {})
      },
      data: { status: 'READY', nextRetryAt: new Date(), lastError: null }
    })
    if (result.count === 0) {
      throw new ValidationError(
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
      { accepted: true, retryingLegs: result.count },
      { status: 202 }
    )
  }
)
