import { NextResponse } from 'next/server'
import { remoteWalletForwardActivityListQuerySchema } from '@lawallet-nwc/shared'
import { requireUserId } from '@/lib/auth/account'
import { prisma } from '@/lib/prisma'
import { loadOwnedRemoteWallet } from '@/lib/remote-wallets/owned'
import { validateParams, validateQuery } from '@/lib/validation/middleware'
import { idParam } from '@/lib/validation/schemas'
import { NotFoundError } from '@/types/server/errors'
import { withErrorHandling } from '@/types/server/error-handler'

export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const userId = await requireUserId(request)
    const { id } = validateParams(await params, idParam)
    await loadOwnedRemoteWallet(id, userId)
    const query = validateQuery(
      request.url,
      remoteWalletForwardActivityListQuerySchema
    )
    const rows = await prisma.remoteWalletForwardAttempt.findMany({
      where: { leg: { receipt: { walletId: id } } },
      select: {
        id: true,
        attemptNo: true,
        amountMsats: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        leg: {
          select: { id: true, receiptId: true, destination: true }
        }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    })
    const hasMore = rows.length > query.limit
    const page = hasMore ? rows.slice(0, query.limit) : rows
    return NextResponse.json({
      activity: page.map(row => ({
        id: row.id,
        receiptId: row.leg.receiptId,
        legId: row.leg.id,
        destination: row.leg.destination,
        attemptNo: row.attemptNo,
        amountMsats: Number(row.amountMsats),
        status: row.status,
        errorMessage: row.errorMessage,
        createdAt: row.createdAt.toISOString()
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null
    })
  }
)
