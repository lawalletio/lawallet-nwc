import { createHash } from 'node:crypto'
import type {
  CardPaymentAttempt,
  CardPaymentTransport
} from '@/lib/generated/prisma'
import { prisma } from '@/lib/prisma'
import type { PayInvoiceResult } from '@/lib/wallet/drivers'

const UNRESOLVED_STATUSES = ['PENDING', 'UNKNOWN'] as const

export function preimageMatchesPaymentHash(
  preimage: string,
  paymentHash: string
): boolean {
  if (!/^[0-9a-f]{64}$/i.test(preimage)) return false
  return (
    createHash('sha256').update(Buffer.from(preimage, 'hex')).digest('hex') ===
    paymentHash.toLowerCase()
  )
}

/**
 * Resolve an attempt exactly once. The status predicate makes a late listener
 * response, webhook, callback retry and foreground request safe to race.
 */
export async function succeedCardPaymentAttempt(
  attempt: Pick<CardPaymentAttempt, 'id' | 'paymentHash'>,
  result: PayInvoiceResult,
  fallbackTransport: CardPaymentTransport
): Promise<boolean> {
  if (!preimageMatchesPaymentHash(result.preimage, attempt.paymentHash)) {
    throw new Error('Payment preimage does not match the invoice payment hash')
  }

  const transport = result.transport ?? fallbackTransport
  const updated = await prisma.cardPaymentAttempt.updateMany({
    where: {
      id: attempt.id,
      transport,
      status: { in: [...UNRESOLVED_STATUSES] }
    },
    data: {
      status: 'SUCCEEDED',
      transport,
      preimage: result.preimage.toLowerCase(),
      feesPaidMsats:
        result.feesPaidMsats ?? Math.max(0, result.feesPaidSats * 1000),
      errorCode: null,
      resolvedAt: new Date()
    }
  })
  return updated.count === 1
}

export async function rejectCardPaymentAttempt(
  attemptId: string,
  errorCode: string,
  transport?: CardPaymentTransport
): Promise<boolean> {
  const updated = await prisma.cardPaymentAttempt.updateMany({
    where: {
      id: attemptId,
      ...(transport ? { transport } : {}),
      status: { in: [...UNRESOLVED_STATUSES] }
    },
    data: {
      status: 'REJECTED',
      ...(transport ? { transport } : {}),
      errorCode,
      resolvedAt: new Date()
    }
  })
  return updated.count === 1
}

export async function markCardPaymentUnknown(
  attemptId: string,
  errorCode: string,
  transport?: CardPaymentTransport
): Promise<boolean> {
  const updated = await prisma.cardPaymentAttempt.updateMany({
    where: {
      id: attemptId,
      ...(transport ? { transport } : {}),
      status: { in: [...UNRESOLVED_STATUSES] }
    },
    data: {
      status: 'UNKNOWN',
      ...(transport ? { transport } : {}),
      errorCode
    }
  })
  return updated.count === 1
}

/** Persist listener's explicit not_started hand-off before direct NWC runs. */
export async function switchCardPaymentAttemptToDirect(
  attemptId: string
): Promise<boolean> {
  const updated = await prisma.cardPaymentAttempt.updateMany({
    where: {
      id: attemptId,
      transport: 'LISTENER',
      status: { in: [...UNRESOLVED_STATUSES] }
    },
    data: { transport: 'DIRECT', errorCode: null }
  })
  return updated.count === 1
}
