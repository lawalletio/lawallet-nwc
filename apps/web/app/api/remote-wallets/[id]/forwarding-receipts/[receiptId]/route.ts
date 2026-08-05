import { NextResponse } from 'next/server'
import { remoteWalletForwardReceiptParamsSchema } from '@lawallet-nwc/shared'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountId } from '@/lib/auth/account'
import { prisma } from '@/lib/prisma'
import { forwardReceiptToDto } from '@/lib/remote-wallet-forwarding/dto'
import { loadOwnedRemoteWallet } from '@/lib/remote-wallet-forwarding/service'
import { validateParams } from '@/lib/validation/middleware'
import { NotFoundError } from '@/types/server/errors'
import { withErrorHandling } from '@/types/server/error-handler'

export const GET = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string; receiptId: string }> }
  ) => {
    const auth = await authenticate(request)
    const userId = await resolveAccountId(auth.pubkey)
    if (!userId) throw new NotFoundError('User not found')
    const { id, receiptId } = validateParams(
      await params,
      remoteWalletForwardReceiptParamsSchema
    )
    await loadOwnedRemoteWallet(id, userId)
    const receipt = await prisma.remoteWalletForwardReceipt.findFirst({
      where: { id: receiptId, walletId: id, userId },
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
    return NextResponse.json(forwardReceiptToDto(receipt))
  }
)
