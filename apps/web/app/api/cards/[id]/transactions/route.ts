import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { extractDescription } from '@/lib/invoice-utils'
import type {
  CardPaymentStatus,
  CardPaymentTransport
} from '@/lib/generated/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export interface CardTransaction {
  id: string
  createdAt: string
  amountSats: number | null
  /** Compatibility summary; use paymentStatus for the exact durable state. */
  status: 'success' | 'failed'
  error: string | null
  /** The wallet type that settled the spend (e.g. NWC). */
  walletType: string | null
  /** The merchant's bolt11 the card paid. */
  bolt11: string | null
  /** Decoded from the bolt11 for the details view. */
  description: string | null
  paymentHash: string | null
  /** Exact state of the durable payment attempt. */
  paymentStatus: CardPaymentStatus
  /** Whether web paid directly or delegated to the optional listener. */
  transport: CardPaymentTransport
}

/**
 * GET /api/cards/[id]/transactions
 *
 * Lists the spends (LNURL-withdraw payments) made by tapping this card, newest
 * first. CardPaymentAttempt is authoritative, so unresolved outcomes remain
 * visible and ActivityLog delivery cannot create gaps in transaction history.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    await authenticateWithPermission(request, Permission.CARDS_READ)
    const { id } = validateParams(await params, idParam)

    const card = await prisma.card.findUnique({
      where: { id },
      select: { id: true }
    })
    if (!card) {
      throw new NotFoundError('Card not found')
    }

    const rows = await prisma.cardPaymentAttempt.findMany({
      where: { cardId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        walletId: true,
        paymentHash: true,
        bolt11: true,
        amountMsats: true,
        transport: true,
        status: true,
        errorCode: true,
        createdAt: true
      }
    })

    const walletIds = [...new Set(rows.map(row => row.walletId))]
    const wallets = walletIds.length
      ? await prisma.remoteWallet.findMany({
          where: { id: { in: walletIds } },
          select: { id: true, type: true }
        })
      : []
    const walletTypes = new Map(
      wallets.map(wallet => [wallet.id, wallet.type] as const)
    )

    const items: CardTransaction[] = rows.map(row => {
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        amountSats: row.amountMsats / 1000,
        status: row.status === 'SUCCEEDED' ? 'success' : 'failed',
        error: row.errorCode,
        walletType: walletTypes.get(row.walletId) ?? null,
        bolt11: row.bolt11,
        description: extractDescription(row.bolt11),
        paymentHash: row.paymentHash,
        paymentStatus: row.status,
        transport: row.transport
      }
    })

    return NextResponse.json({ items })
  }
)
