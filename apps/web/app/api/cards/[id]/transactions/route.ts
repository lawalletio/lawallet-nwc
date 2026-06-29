import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { ActivityEvent } from '@/lib/activity-log'
import { extractDescription, extractPaymentHash } from '@/lib/invoice-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export interface CardTransaction {
  id: string
  createdAt: string
  amountSats: number | null
  status: 'success' | 'failed'
  error: string | null
  /** The wallet type that settled the spend (e.g. NWC). */
  walletType: string | null
  /** The merchant's bolt11 the card paid. */
  bolt11: string | null
  /** Decoded from the bolt11 for the details view. */
  description: string | null
  paymentHash: string | null
}

/**
 * GET /api/cards/[id]/transactions
 *
 * Lists the spends (LNURL-withdraw payments) made by tapping this card, newest
 * first. Sourced from the `card.payment` ActivityLog rows the scan/cb pay action
 * writes, filtered by `metadata.cardId`. Only payments made after this feature
 * shipped are recorded — older taps have no transaction history.
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

    const rows = await prisma.activityLog.findMany({
      where: {
        category: 'CARD',
        event: ActivityEvent.CARD_PAYMENT,
        metadata: { path: ['cardId'], equals: id }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100
    })

    const items: CardTransaction[] = rows.map(row => {
      const m = (row.metadata ?? {}) as Record<string, unknown>
      const bolt11 = typeof m.bolt11 === 'string' ? m.bolt11 : null
      return {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        amountSats: typeof m.amountSats === 'number' ? m.amountSats : null,
        status: m.status === 'failed' ? 'failed' : 'success',
        error: typeof m.error === 'string' ? m.error : null,
        walletType: typeof m.walletType === 'string' ? m.walletType : null,
        bolt11,
        description: bolt11 ? extractDescription(bolt11) : null,
        paymentHash: bolt11 ? extractPaymentHash(bolt11) : null
      }
    })

    return NextResponse.json({ items })
  }
)
