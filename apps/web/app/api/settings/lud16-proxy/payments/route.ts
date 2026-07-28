import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateSettingsReadRequest } from '@/lib/settings-auth'
import { withErrorHandling } from '@/types/server/error-handler'
import { ValidationError } from '@/types/server/errors'

const STATUSES = [
  'PENDING_INBOUND',
  'READY_TO_FORWARD',
  'FORWARDING',
  'RECEIPT_PENDING',
  'BLOCKED',
  'COMPLETED',
  'EXPIRED'
] as const

export const GET = withErrorHandling(async (request: NextRequest) => {
  await authenticateSettingsReadRequest(request)
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new ValidationError('Invalid proxy payment status')
  }
  const payments = await prisma.proxyPayment.findMany({
    where: status
      ? {
          status: status as (typeof STATUSES)[number]
        }
      : undefined,
    include: {
      invoice: {
        select: {
          paymentHash: true,
          status: true,
          paidAt: true,
          expiresAt: true
        }
      },
      attempts: { orderBy: { attemptNo: 'desc' }, take: 1 },
      _count: { select: { attempts: true } }
    },
    orderBy: { createdAt: 'desc' },
    take: 100
  })
  return NextResponse.json({
    payments: payments.map(payment => ({
      id: payment.id,
      username: payment.username,
      destination: payment.destination,
      status: payment.status,
      grossAmountMsats: payment.grossAmountMsats.toString(),
      serviceFeeMsats: payment.serviceFeeMsats.toString(),
      destinationAmountMsats: payment.destinationAmountMsats.toString(),
      routingFeeMsats: payment.routingFeeMsats?.toString() ?? null,
      sourceStatus: payment.invoice.status,
      sourcePaymentHash: payment.invoice.paymentHash,
      sourcePaidAt: payment.sourcePaidAt?.toISOString() ?? null,
      forwardedAt: payment.forwardedAt?.toISOString() ?? null,
      receiptPublishedAt: payment.receiptPublishedAt?.toISOString() ?? null,
      retryCount: payment.retryCount,
      nextRetryAt: payment.nextRetryAt.toISOString(),
      lastError: payment.lastError,
      currentAttempt: payment.attempts[0]
        ? {
            bolt11: payment.attempts[0].bolt11,
            attemptNo: payment.attempts[0].attemptNo,
            status: payment.attempts[0].status,
            paymentHash: payment.attempts[0].paymentHash,
            expiresAt: payment.attempts[0].expiresAt.toISOString(),
            error:
              payment.attempts[0].errorMessage ?? payment.attempts[0].errorCode
          }
        : null,
      attemptCount: payment._count.attempts,
      createdAt: payment.createdAt.toISOString()
    }))
  })
})
