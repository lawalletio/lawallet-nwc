import { NextResponse } from 'next/server'
import { remoteWalletForwardReceiptParamsSchema } from '@lawallet-nwc/shared'
import { prisma } from '@/lib/prisma'
import { forwardReceiptToDto } from '@/lib/remote-wallet-forwarding/dto'
import { commentsByPaymentHash } from '@/lib/remote-wallet-forwarding/comments'
import { loadViewableRemoteWallet } from '@/lib/remote-wallets/owned'
import { validateParams } from '@/lib/validation/middleware'
import { NotFoundError } from '@/types/server/errors'
import { withErrorHandling } from '@/types/server/error-handler'

export const GET = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; receiptId: string }> }
  ) => {
    const { id, receiptId } = validateParams(
      await params,
      remoteWalletForwardReceiptParamsSchema
    )
    const { wallet } = await loadViewableRemoteWallet(id, request)
    const receipt = await prisma.remoteWalletForwardReceipt.findFirst({
      // Scoped to the wallet's OWNER, not the caller — an admin viewing
      // someone else's wallet must still see that wallet's receipts.
      where: { id: receiptId, walletId: id, userId: wallet.userId },
      include: {
        revision: {
          select: {
            feeBps: true,
            baseFeeMsats: true,
            destinations: {
              select: { address: true, allocationBps: true },
              orderBy: { position: 'asc' }
            }
          }
        },
        legs: {
          include: {
            attempts: { orderBy: { attemptNo: 'desc' } },
            batchAnchor: {
              select: {
                attempts: { orderBy: { attemptNo: 'desc' } }
              }
            }
          },
          orderBy: { position: 'asc' }
        }
      }
    })
    if (!receipt) throw new NotFoundError('Forwarding receipt not found')
    const comments = await commentsByPaymentHash([receipt.sourcePaymentHash])
    return NextResponse.json(
      forwardReceiptToDto(
        receipt,
        comments.get(receipt.sourcePaymentHash.toLowerCase()) ?? null
      )
    )
  }
)
