import { NextResponse } from 'next/server'
import type { Prisma } from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import {
  proxyForwardingCommandParams,
  proxyForwardingCommandSchema
} from '@/lib/validation/schemas'
import { parseLightningAddress } from '@/lib/wallet/resolve-payment-route'
import { resolvePublicEndpoint } from '@/lib/public-url'
import { fetchDestinationMetadata } from '@/lib/proxy/lnurl'
import { reconcileProxyPayments } from '@/lib/proxy/reconcile'
import { PROXY_RETRY_INTERVAL_MS } from '@/lib/proxy/constants'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type RouteParams = {
  params: Promise<{ username: string; invoiceId: string }>
}

/**
 * POST /api/wallet/addresses/[username]/invoices/[invoiceId]/forwarding
 *
 * Owner-only recovery commands for an inbound payment whose deferred
 * forwarding is BLOCKED. A destination change affects this settlement only;
 * future payments continue using the Lightning Address configuration.
 */
export const POST = withErrorHandling(
  async (request: Request, { params }: RouteParams) => {
    await checkRequestLimits(request, 'json')
    const { pubkey } = await authenticate(request)
    const { username, invoiceId } = validateParams(
      await params,
      proxyForwardingCommandParams
    )
    const command = await validateBody(request, proxyForwardingCommandSchema)

    const user = await resolveAccountByPubkey(pubkey)
    if (!user) throw new AuthenticationError('User not found')

    const address = await prisma.lightningAddress.findUnique({
      where: { username },
      select: { userId: true }
    })
    if (!address || address.userId !== user.id) {
      throw new NotFoundError('Address not found')
    }

    const payment = await prisma.proxyPayment.findUnique({
      where: { invoiceId },
      include: {
        invoice: { select: { userId: true, purpose: true } },
        attempts: { orderBy: { attemptNo: 'desc' } }
      }
    })
    if (
      !payment ||
      payment.username !== username ||
      payment.invoice.userId !== user.id ||
      payment.invoice.purpose !== 'LUD16_PAYMENT'
    ) {
      throw new NotFoundError('Proxy payment not found')
    }
    if (payment.status !== 'BLOCKED') {
      throw new ConflictError('Only blocked forwarding can be recovered')
    }

    if (command.action === 'change_destination') {
      const parsed = parseLightningAddress(command.destination)
      if (!parsed) throw new ValidationError('Must be a valid LN address')

      const ambiguous = payment.attempts.find(attempt =>
        ['PENDING', 'UNKNOWN'].includes(attempt.status)
      )
      if (ambiguous) {
        throw new ConflictError(
          'The previous outgoing payment must be resolved before changing destination'
        )
      }
      if (payment.attempts.some(attempt => attempt.status === 'SUCCEEDED')) {
        throw new ConflictError('This payment has already been forwarded')
      }

      const endpoint = await resolvePublicEndpoint(request)
      if (
        new URL(endpoint.url).hostname.toLowerCase() ===
        parsed.host.toLowerCase()
      ) {
        throw new ValidationError(
          'Forwarding destination cannot point to this LaWallet instance'
        )
      }

      const metadata = await fetchDestinationMetadata(command.destination, {
        blockedHosts: payment.blockedHosts
      })
      const amountMsats = Number(payment.destinationAmountMsats)
      if (
        amountMsats < metadata.minSendable ||
        amountMsats > metadata.maxSendable
      ) {
        throw new ValidationError(
          'The new destination does not accept the forwarded amount'
        )
      }

      const now = new Date()
      const latestRejected = payment.attempts.find(
        attempt => attempt.status === 'REJECTED'
      )
      await prisma.$transaction(async tx => {
        if (latestRejected) {
          await tx.proxyForwardAttempt.update({
            where: { id: latestRejected.id },
            data: {
              errorCode: 'destination_changed',
              errorMessage: `Superseded by ${command.destination}`,
              resolvedAt: latestRejected.resolvedAt ?? now
            }
          })
        }
        await tx.proxyPayment.update({
          where: { id: payment.id },
          data: {
            destination: command.destination,
            destinationMetadata: metadata as unknown as Prisma.InputJsonValue,
            lastError: 'Destination updated. Retry forwarding when ready.',
            nextRetryAt: new Date(now.getTime() + PROXY_RETRY_INTERVAL_MS),
            leaseOwner: null,
            leaseExpiresAt: null
          }
        })
      })

      eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })
      logActivity.fireAndForget({
        category: 'NWC',
        event: ActivityEvent.PROXY_DESTINATION_CHANGED,
        message: `Proxy destination changed for ${username}`,
        userId: user.id,
        metadata: {
          username,
          invoiceId,
          proxyPaymentId: payment.id,
          previousDestination: payment.destination,
          destination: command.destination
        }
      })

      return NextResponse.json({
        success: true,
        action: command.action,
        payment: {
          id: payment.id,
          status: 'BLOCKED',
          destination: command.destination,
          lastError: 'Destination updated. Retry forwarding when ready.'
        }
      })
    }

    const released = await prisma.proxyPayment.updateMany({
      where: {
        id: payment.id,
        status: 'BLOCKED',
        OR: [{ leaseOwner: null }, { leaseExpiresAt: { lt: new Date() } }]
      },
      data: {
        status: 'READY_TO_FORWARD',
        nextRetryAt: new Date(),
        lastError: null,
        leaseOwner: null,
        leaseExpiresAt: null
      }
    })
    if (released.count === 0) {
      throw new ConflictError('Forwarding is already being retried')
    }

    logActivity.fireAndForget({
      category: 'NWC',
      event: ActivityEvent.PROXY_FORWARD_RETRY_REQUESTED,
      message: `Proxy forwarding retry requested for ${username}`,
      userId: user.id,
      metadata: { username, invoiceId, proxyPaymentId: payment.id }
    })

    const reconciliation = await reconcileProxyPayments({
      ids: [payment.id],
      limit: 1
    })
    const current = await prisma.proxyPayment.findUnique({
      where: { id: payment.id },
      select: {
        id: true,
        status: true,
        destination: true,
        lastError: true
      }
    })
    eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })

    return NextResponse.json({
      success: true,
      action: command.action,
      reconciliation,
      payment: current
    })
  }
)
