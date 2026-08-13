import { NextResponse } from 'next/server'
import { remoteWalletForwardReceiptListQuerySchema } from '@lawallet-nwc/shared'
import { prisma } from '@/lib/prisma'
import { commentsByPaymentHash } from '@/lib/remote-wallet-forwarding/comments'
import { forwardReceiptToDto } from '@/lib/remote-wallet-forwarding/dto'
import { loadViewableRemoteWallet } from '@/lib/remote-wallets/owned'
import { validateParams, validateQuery } from '@/lib/validation/middleware'
import { idParam } from '@/lib/validation/schemas'
import { NotFoundError } from '@/types/server/errors'
import { withErrorHandling } from '@/types/server/error-handler'

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = validateParams(await params, idParam)
    await loadViewableRemoteWallet(id, request)
    const query = validateQuery(
      request.url,
      remoteWalletForwardReceiptListQuerySchema
    )
    const rows = await prisma.remoteWalletForwardReceipt.findMany({
      where: {
        walletId: id,
        ...(query.status ? { status: query.status } : {})
      },
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
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    })
    const hasMore = rows.length > query.limit
    const page = hasMore ? rows.slice(0, query.limit) : rows
    // One lookup for the whole page: the LUD-12 comment lives on the invoice
    // that funded the receipt, keyed by the same payment hash.
    const comments = await commentsByPaymentHash(
      page.map(receipt => receipt.sourcePaymentHash)
    )
    return NextResponse.json({
      receipts: page.map(receipt =>
        forwardReceiptToDto(
          receipt,
          comments.get(receipt.sourcePaymentHash.toLowerCase()) ?? null
        )
      ),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null
    })
  }
)
