import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthenticationError, NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { validateParams } from '@/lib/validation/middleware'
import { walletAddressUsernameParam } from '@/lib/validation/schemas'
import type { InvoiceMetadata } from '@/lib/invoice-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DEFAULT_LIMIT = 20

export interface AddressInvoiceDto {
  id: string
  amountSats: number
  description: string
  status: 'PENDING' | 'PAID' | 'EXPIRED'
  /** LUD-12 payer comment, extracted from `Invoice.metadata.comment`. */
  comment: string | null
  paymentHash: string
  createdAt: string
  paidAt: string | null
  expiresAt: string
}

/**
 * GET /api/wallet/addresses/[username]/invoices
 *
 * Recent invoices minted for a single lightning address via the LUD-16
 * callback. Unlike NWC `list_transactions` (which is per-wallet and often
 * rate-limited or blocked by wallet providers), this is a local query on
 * our own `Invoice` table and can be filtered down to a specific address.
 *
 * Scope:
 *   - Caller must own the address (same ownership check as the detail
 *     route — 404 leaks the same response either way).
 *   - Only `purpose=LUD16_PAYMENT` invoices are returned; registration
 *     invoices and other purposes stay out of this view.
 *   - Postgres JSON path filter `metadata.username = <username>` pins
 *     results to this address. The `Invoice` model has no foreign key to
 *     `LightningAddress`, so we match on the metadata that the LUD-16 cb
 *     route writes (`{ username, comment? }`).
 *
 * Sort: paid-first, then newest created. A zero-amount rest is unlikely
 * to matter in practice — the list is capped at 20.
 */
export const GET = withErrorHandling(
  async (request: Request, { params }: { params: Promise<{ username: string }> }) => {
    const { pubkey } = await authenticate(request)
    const { username } = validateParams(await params, walletAddressUsernameParam)

    const user = await prisma.user.findUnique({
      where: { pubkey },
      select: { id: true },
    })
    if (!user) throw new AuthenticationError('User not found')

    const address = await prisma.lightningAddress.findUnique({
      where: { username },
      select: { userId: true },
    })
    if (!address || address.userId !== user.id) {
      throw new NotFoundError('Address not found')
    }

    const invoices = await prisma.invoice.findMany({
      where: {
        userId: user.id,
        purpose: 'LUD16_PAYMENT',
        metadata: { path: ['username'], equals: username },
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: DEFAULT_LIMIT,
      select: {
        id: true,
        amountSats: true,
        description: true,
        status: true,
        metadata: true,
        paymentHash: true,
        createdAt: true,
        paidAt: true,
        expiresAt: true,
      },
    })

    const response: AddressInvoiceDto[] = invoices.map(inv => {
      const meta = (inv.metadata ?? {}) as InvoiceMetadata
      return {
        id: inv.id,
        amountSats: inv.amountSats,
        description: inv.description,
        status: inv.status,
        comment: typeof meta.comment === 'string' ? meta.comment : null,
        paymentHash: inv.paymentHash,
        createdAt: inv.createdAt.toISOString(),
        paidAt: inv.paidAt?.toISOString() ?? null,
        expiresAt: inv.expiresAt.toISOString(),
      }
    })

    return NextResponse.json({ invoices: response })
  },
)
