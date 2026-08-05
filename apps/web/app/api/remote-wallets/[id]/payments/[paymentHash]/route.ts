import { NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountId } from '@/lib/auth/account'
import { prisma } from '@/lib/prisma'
import { loadOwnedRemoteWallet } from '@/lib/remote-wallet-forwarding/service'
import { validateParams } from '@/lib/validation/middleware'
import { idParam } from '@/lib/validation/schemas'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { withErrorHandling } from '@/types/server/error-handler'

const paymentHashParam = {
  parse(input: unknown) {
    if (
      !input ||
      typeof input !== 'object' ||
      !('paymentHash' in input) ||
      typeof input.paymentHash !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(input.paymentHash)
    ) {
      throw new ValidationError('Invalid payment hash')
    }
    return { paymentHash: input.paymentHash.toLowerCase() }
  }
}

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
    const auth = await authenticate(request)
    const userId = await resolveAccountId(auth.pubkey)
    if (!userId) throw new NotFoundError('User not found')
    const { id, paymentHash } = await params
    const walletId = validateParams({ id }, idParam).id
    const hash = paymentHashParam.parse({ paymentHash }).paymentHash
    await loadOwnedRemoteWallet(walletId, userId)

    const invoice = await prisma.invoice.findFirst({
      where: { paymentHash: hash, remoteWalletId: walletId, userId },
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
