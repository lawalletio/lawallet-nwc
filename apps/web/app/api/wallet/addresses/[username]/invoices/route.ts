import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import { AuthenticationError, NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateParams } from '@/lib/validation/middleware'
import { walletAddressUsernameParam } from '@/lib/validation/schemas'
import type { InvoiceMetadata } from '@/lib/invoice-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const DEFAULT_LIMIT = 20

export interface AddressInvoiceDto {
  id: string
  amountSats: number
  amountMsats: string
  bolt11: string
  description: string
  status: 'PENDING' | 'PAID' | 'EXPIRED'
  /** LUD-12 payer comment, extracted from `Invoice.metadata.comment`. */
  comment: string | null
  paymentHash: string
  createdAt: string
  paidAt: string | null
  expiresAt: string
  proxy: {
    id: string
    status: string
    destination: string
    feeBps: number
    grossAmountMsats: string
    serviceFeeMsats: string
    destinationAmountMsats: string
    forwardedAmountMsats: string | null
    routingFeeMsats: string | null
    sourcePaidAt: string | null
    forwardedAt: string | null
    receiptEventId: string | null
    receiptPublishedAt: string | null
    retryCount: number
    nextRetryAt: string
    leaseExpiresAt: string | null
    lastError: string | null
    createdAt: string
    updatedAt: string
    attemptCount: number
    attempts: Array<{
      id: string
      attemptNo: number
      requestId: string
      bolt11: string
      paymentHash: string
      amountMsats: string
      status: string
      routingFeeMsats: string | null
      errorCode: string | null
      errorMessage: string | null
      expiresAt: string
      createdAt: string
      updatedAt: string
      resolvedAt: string | null
    }>
  } | null
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
  async (
    request: Request,
    { params }: { params: Promise<{ username: string }> }
  ) => {
    const { pubkey } = await authenticate(request)
    const { username } = validateParams(
      await params,
      walletAddressUsernameParam
    )

    const user = await resolveAccountByPubkey(pubkey)
    if (!user) throw new AuthenticationError('User not found')

    const address = await prisma.lightningAddress.findUnique({
      where: { username },
      select: { userId: true }
    })
    if (!address || address.userId !== user.id) {
      throw new NotFoundError('Address not found')
    }

    const invoices = await prisma.invoice.findMany({
      where: {
        userId: user.id,
        purpose: 'LUD16_PAYMENT',
        metadata: { path: ['username'], equals: username }
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: DEFAULT_LIMIT,
      select: {
        id: true,
        amountSats: true,
        amountMsats: true,
        bolt11: true,
        description: true,
        status: true,
        metadata: true,
        paymentHash: true,
        createdAt: true,
        paidAt: true,
        expiresAt: true,
        proxyPayment: {
          select: {
            id: true,
            status: true,
            destination: true,
            feeBps: true,
            grossAmountMsats: true,
            serviceFeeMsats: true,
            destinationAmountMsats: true,
            forwardedAmountMsats: true,
            routingFeeMsats: true,
            sourcePaidAt: true,
            forwardedAt: true,
            receiptEventId: true,
            receiptPublishedAt: true,
            retryCount: true,
            nextRetryAt: true,
            leaseExpiresAt: true,
            lastError: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { attempts: true } },
            attempts: {
              orderBy: { attemptNo: 'desc' },
              select: {
                id: true,
                attemptNo: true,
                requestId: true,
                bolt11: true,
                paymentHash: true,
                amountMsats: true,
                status: true,
                routingFeeMsats: true,
                errorCode: true,
                errorMessage: true,
                expiresAt: true,
                createdAt: true,
                updatedAt: true,
                resolvedAt: true
              }
            }
          }
        }
      }
    })

    const response: AddressInvoiceDto[] = invoices.map(inv => {
      const meta = (inv.metadata ?? {}) as InvoiceMetadata
      const proxy = inv.proxyPayment
      return {
        id: inv.id,
        amountSats: inv.amountSats,
        amountMsats: (
          inv.amountMsats ?? BigInt(inv.amountSats * 1000)
        ).toString(),
        bolt11: inv.bolt11,
        description: inv.description,
        status: inv.status,
        comment: typeof meta.comment === 'string' ? meta.comment : null,
        paymentHash: inv.paymentHash,
        createdAt: inv.createdAt.toISOString(),
        paidAt: inv.paidAt?.toISOString() ?? null,
        expiresAt: inv.expiresAt.toISOString(),
        proxy: proxy
          ? {
              id: proxy.id,
              status: proxy.status,
              destination: proxy.destination,
              feeBps: proxy.feeBps,
              grossAmountMsats: proxy.grossAmountMsats.toString(),
              serviceFeeMsats: proxy.serviceFeeMsats.toString(),
              destinationAmountMsats: proxy.destinationAmountMsats.toString(),
              forwardedAmountMsats:
                proxy.forwardedAmountMsats?.toString() ?? null,
              routingFeeMsats: proxy.routingFeeMsats?.toString() ?? null,
              sourcePaidAt: proxy.sourcePaidAt?.toISOString() ?? null,
              forwardedAt: proxy.forwardedAt?.toISOString() ?? null,
              receiptEventId: proxy.receiptEventId,
              receiptPublishedAt:
                proxy.receiptPublishedAt?.toISOString() ?? null,
              retryCount: proxy.retryCount,
              nextRetryAt: proxy.nextRetryAt.toISOString(),
              leaseExpiresAt: proxy.leaseExpiresAt?.toISOString() ?? null,
              lastError: proxy.lastError,
              createdAt: proxy.createdAt.toISOString(),
              updatedAt: proxy.updatedAt.toISOString(),
              attemptCount: proxy._count.attempts,
              attempts: proxy.attempts.map(attempt => ({
                id: attempt.id,
                attemptNo: attempt.attemptNo,
                requestId: attempt.requestId,
                bolt11: attempt.bolt11,
                paymentHash: attempt.paymentHash,
                amountMsats: attempt.amountMsats.toString(),
                status: attempt.status,
                routingFeeMsats: attempt.routingFeeMsats?.toString() ?? null,
                errorCode: attempt.errorCode,
                errorMessage: attempt.errorMessage,
                expiresAt: attempt.expiresAt.toISOString(),
                createdAt: attempt.createdAt.toISOString(),
                updatedAt: attempt.updatedAt.toISOString(),
                resolvedAt: attempt.resolvedAt?.toISOString() ?? null
              }))
            }
          : null
      }
    })

    return NextResponse.json({ invoices: response })
  }
)
