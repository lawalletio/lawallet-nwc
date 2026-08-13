import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loadViewableRemoteWallet } from '@/lib/remote-wallets/owned'
import { z } from 'zod'
import { validateParams } from '@/lib/validation/middleware'
import { NotFoundError } from '@/types/server/errors'
import { withErrorHandling } from '@/types/server/error-handler'

const paymentRouteParams = z.object({
  id: z.string().min(1),
  paymentHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'Invalid payment hash')
    .transform(value => value.toLowerCase())
})

/**
 * Payment-only audit endpoint for a RemoteWallet. It deliberately returns an
 * empty zap envelope for regular NWC transactions: callers never need to
 * learn whether a hash belongs to another wallet or user.
 */
export const GET = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; paymentHash: string }> }
  ) => {
    const { id: walletId, paymentHash: hash } = validateParams(
      await params,
      paymentRouteParams
    )
    const { wallet } = await loadViewableRemoteWallet(walletId, request)

    const invoice = await prisma.invoice.findFirst({
      where: {
        paymentHash: hash,
        remoteWalletId: walletId,
        userId: wallet.userId
      },
      select: {
        zapRequest: true,
        zapRequestJson: true,
        zapReceipt: true,
        zapReceiptJson: true,
        zapReceiptEventId: true,
        zapReceiptPublishedAt: true,
        zapReceiptError: true,
        zapReceiptNextRetryAt: true
      }
    })
    if (!invoice?.zapRequest || !invoice.zapRequestJson) {
      return NextResponse.json({ zap: null })
    }
    return NextResponse.json({
      zap: {
        request: invoice.zapRequest,
        requestJson: invoice.zapRequestJson,
        receipt: invoice.zapReceipt,
        receiptJson: invoice.zapReceiptJson,
        receiptEventId: invoice.zapReceiptEventId,
        receiptPublishedAt:
          invoice.zapReceiptPublishedAt?.toISOString() ?? null,
        error: invoice.zapReceiptError,
        nextRetryAt: invoice.zapReceiptNextRetryAt?.toISOString() ?? null
      }
    })
  }
)
