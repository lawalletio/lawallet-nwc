import { NextResponse } from 'next/server'
import type { Prisma } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateParams } from '@/lib/validation/middleware'
import { walletAddressUsernameParam } from '@/lib/validation/schemas'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  ConflictError,
  NotFoundError
} from '@/types/server/errors'
import { reconcileProxyPayments } from '@/lib/proxy/reconcile'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/wallet/addresses/[username]/proxy-balance
 *
 * Returns the exact net amount still owed to deferred-proxy destinations.
 * Only confirmed inbound invoices count. A settlement is removed as soon as
 * an outgoing attempt is proven successful, even if its final bookkeeping or
 * zap receipt is still being completed.
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
      select: { userId: true, mode: true, redirect: true }
    })
    if (!address || address.userId !== user.id) {
      throw new NotFoundError('Address not found')
    }

    const outstanding: Prisma.ProxyPaymentWhereInput = {
      username,
      status: {
        in: ['PENDING_INBOUND', 'READY_TO_FORWARD', 'FORWARDING', 'BLOCKED']
      },
      forwardedAt: null,
      forwardedAmountMsats: null,
      invoice: { is: { userId: user.id, status: 'PAID' } },
      attempts: { none: { status: 'SUCCEEDED' } }
    }

    const [aggregate, blockedPaymentCount, inFlightPaymentCount] =
      await Promise.all([
        prisma.proxyPayment.aggregate({
          where: outstanding,
          _sum: { destinationAmountMsats: true },
          _count: { _all: true },
          _min: { createdAt: true }
        }),
        prisma.proxyPayment.count({
          where: { ...outstanding, status: 'BLOCKED' }
        }),
        prisma.proxyPayment.count({
          where: {
            AND: [
              outstanding,
              {
                OR: [
                  { status: 'FORWARDING' },
                  { leaseExpiresAt: { gt: new Date() } },
                  {
                    attempts: {
                      some: { status: { in: ['PENDING', 'UNKNOWN'] } }
                    }
                  }
                ]
              }
            ]
          }
        })
      ])

    return NextResponse.json({
      pendingAmountMsats: (
        aggregate._sum.destinationAmountMsats ?? BigInt(0)
      ).toString(),
      pendingPaymentCount: aggregate._count._all,
      blockedPaymentCount,
      inFlightPaymentCount,
      oldestPendingAt: aggregate._min.createdAt?.toISOString() ?? null,
      destination: address.mode === 'PROXY_ALIAS' ? address.redirect : null
    })
  }
)

interface LockedPendingPayment {
  id: string
  status: string
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  hasAmbiguousAttempt: boolean
}

/**
 * POST /api/wallet/addresses/[username]/proxy-balance
 *
 * Manually releases every safe pending settlement for immediate
 * reconciliation. The SELECT locks the payment rows, so a cron worker uses
 * SKIP LOCKED while this command checks for active leases or ambiguous
 * outgoing attempts. The reconciler's lease and request-id journal remain the
 * final idempotency boundary after commit.
 */
export const POST = withErrorHandling(
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
      select: { userId: true, mode: true }
    })
    if (
      !address ||
      address.userId !== user.id ||
      address.mode !== 'PROXY_ALIAS'
    ) {
      throw new NotFoundError('Address not found')
    }

    const paymentIds = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<LockedPendingPayment[]>`
        SELECT
          p."id",
          p."status"::text AS "status",
          p."leaseOwner",
          p."leaseExpiresAt",
          EXISTS (
            SELECT 1
              FROM "ProxyForwardAttempt" a
             WHERE a."proxyPaymentId" = p."id"
               AND a."status" IN (
                 'PENDING'::"ProxyForwardAttemptStatus",
                 'UNKNOWN'::"ProxyForwardAttemptStatus"
               )
          ) AS "hasAmbiguousAttempt"
          FROM "ProxyPayment" p
          JOIN "Invoice" i ON i."id" = p."invoiceId"
         WHERE p."username" = ${username}
           AND i."userId" = ${user.id}
           AND i."status" = 'PAID'::"InvoiceStatus"
           AND p."status" IN (
             'PENDING_INBOUND'::"ProxyPaymentStatus",
             'READY_TO_FORWARD'::"ProxyPaymentStatus",
             'FORWARDING'::"ProxyPaymentStatus",
             'BLOCKED'::"ProxyPaymentStatus"
           )
           AND p."forwardedAt" IS NULL
           AND p."forwardedAmountMsats" IS NULL
           AND NOT EXISTS (
             SELECT 1
               FROM "ProxyForwardAttempt" succeeded
              WHERE succeeded."proxyPaymentId" = p."id"
                AND succeeded."status" = 'SUCCEEDED'::"ProxyForwardAttemptStatus"
           )
         ORDER BY p."createdAt" ASC
         FOR UPDATE OF p
      `

      if (rows.length === 0) {
        throw new ConflictError('There are no pending funds to forward')
      }

      const now = new Date()
      const active = rows.find(
        row =>
          row.status === 'FORWARDING' ||
          row.hasAmbiguousAttempt ||
          (row.leaseExpiresAt !== null && row.leaseExpiresAt > now)
      )
      if (active) {
        throw new ConflictError(
          'A pending payment is already forwarding or awaiting confirmation'
        )
      }

      const ids = rows.map(row => row.id)
      const released = await tx.proxyPayment.updateMany({
        where: {
          id: { in: ids },
          status: { in: ['PENDING_INBOUND', 'READY_TO_FORWARD', 'BLOCKED'] },
          forwardedAt: null,
          forwardedAmountMsats: null,
          OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: now } }],
          attempts: {
            none: { status: { in: ['PENDING', 'UNKNOWN', 'SUCCEEDED'] } }
          }
        },
        data: {
          status: 'READY_TO_FORWARD',
          nextRetryAt: now,
          lastError: null,
          leaseOwner: null,
          leaseExpiresAt: null
        }
      })
      if (released.count !== ids.length) {
        throw new ConflictError(
          'Pending forwarding state changed; refresh before retrying'
        )
      }
      return ids
    })

    logActivity.fireAndForget({
      category: 'NWC',
      event: ActivityEvent.PROXY_FORWARD_RETRY_REQUESTED,
      message: `Pending proxy forwarding requested for ${username}`,
      userId: user.id,
      metadata: { username, proxyPaymentIds: paymentIds }
    })

    const reconciliation = await reconcileProxyPayments({ ids: paymentIds })
    eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })

    return NextResponse.json({
      success: true,
      queued: paymentIds.length,
      reconciliation
    })
  }
)
