import { FORWARDING_AMOUNT_TOO_SMALL_ERROR } from './money'

type AttemptRow = {
  id: string
  attemptNo: number
  bolt11: string
  paymentHash: string
  amountMsats: bigint
  requestId: string
  status: string
  preimage: string | null
  routingFeeMsats: bigint | null
  routingReserveMsats: bigint
  errorCode: string | null
  errorMessage: string | null
  expiresAt: Date
  createdAt: Date
  resolvedAt: Date | null
}

type LegRow = {
  id: string
  position: number
  destination: string
  allocationBps: number
  requestedAmountMsats: bigint
  forwardedAmountMsats: bigint | null
  routingFeeMsats: bigint | null
  routingReserveMsats: bigint
  unusedRoutingReserveMsats: bigint
  routingFeeOverageMsats: bigint
  destinationShortfallMsats: bigint
  status: string
  retryCount: number
  nextRetryAt: Date
  lastError: string | null
  createdAt: Date
  completedAt: Date | null
  batchAnchorId?: string | null
  batchAnchor?: { attempts?: AttemptRow[] } | null
  attempts?: AttemptRow[]
}

export type ForwardReceiptRow = {
  id: string
  walletId: string
  eventKey: string
  sourcePaymentHash: string
  sourceInvoice: string | null
  grossAmountMsats: bigint
  retainedFeeMsats: bigint
  targetAmountMsats: bigint
  forwardedAmountMsats: bigint
  routingFeeMsats: bigint
  routingReserveMsats: bigint
  unusedRoutingReserveMsats: bigint
  routingFeeOverageMsats: bigint
  shortfallMsats: bigint
  configRevision: number
  status: string
  recovered: boolean
  sourceSettledAt: Date
  lastError: string | null
  nextRetryAt: Date
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
  revision?: {
    feeBps: number
    baseFeeMsats: bigint
    destinations: Array<{ address: string; allocationBps: number }>
  }
  legs: LegRow[]
}

export function forwardReceiptToDto(receipt: ForwardReceiptRow) {
  const hasActiveLegs = receipt.legs.some(leg => leg.status !== 'SUPERSEDED')
  const lastError =
    receipt.lastError ??
    (receipt.status === 'BLOCKED' &&
    receipt.targetAmountMsats > BigInt(0) &&
    !hasActiveLegs
      ? FORWARDING_AMOUNT_TOO_SMALL_ERROR
      : null)

  return {
    id: receipt.id,
    walletId: receipt.walletId,
    eventKey: receipt.eventKey,
    sourcePaymentHash: receipt.sourcePaymentHash,
    sourceInvoice: receipt.sourceInvoice,
    grossAmountMsats: Number(receipt.grossAmountMsats),
    retainedFeeMsats: Number(receipt.retainedFeeMsats),
    targetAmountMsats: Number(receipt.targetAmountMsats),
    forwardedAmountMsats: Number(receipt.forwardedAmountMsats),
    routingFeeMsats: Number(receipt.routingFeeMsats),
    routingReserveMsats: Number(receipt.routingReserveMsats),
    unusedRoutingReserveMsats: Number(receipt.unusedRoutingReserveMsats),
    routingFeeOverageMsats: Number(receipt.routingFeeOverageMsats),
    shortfallMsats: Number(receipt.shortfallMsats),
    configRevision: receipt.configRevision,
    status: receipt.status,
    recovered: receipt.recovered,
    sourceSettledAt: receipt.sourceSettledAt.toISOString(),
    lastError,
    nextRetryAt: receipt.nextRetryAt.toISOString(),
    completedAt: receipt.completedAt?.toISOString() ?? null,
    createdAt: receipt.createdAt.toISOString(),
    updatedAt: receipt.updatedAt.toISOString(),
    revision: receipt.revision
      ? {
          feeBps: receipt.revision.feeBps,
          baseFeeSats: Number(receipt.revision.baseFeeMsats / BigInt(1000)),
          destinations: receipt.revision.destinations
        }
      : undefined,
    legs: receipt.legs.map(leg => ({
      id: leg.id,
      position: leg.position,
      destination: leg.destination,
      allocationBps: leg.allocationBps,
      requestedAmountMsats: Number(leg.requestedAmountMsats),
      forwardedAmountMsats:
        leg.forwardedAmountMsats === null
          ? null
          : Number(leg.forwardedAmountMsats),
      routingFeeMsats:
        leg.routingFeeMsats === null ? null : Number(leg.routingFeeMsats),
      routingReserveMsats: Number(leg.routingReserveMsats),
      unusedRoutingReserveMsats: Number(leg.unusedRoutingReserveMsats),
      routingFeeOverageMsats: Number(leg.routingFeeOverageMsats),
      destinationShortfallMsats: Number(leg.destinationShortfallMsats),
      status: leg.status,
      retryCount: leg.retryCount,
      nextRetryAt: leg.nextRetryAt.toISOString(),
      lastError: leg.lastError,
      createdAt: leg.createdAt.toISOString(),
      completedAt: leg.completedAt?.toISOString() ?? null,
      batchAnchorId: leg.batchAnchorId ?? null,
      attempts: (leg.attempts?.length
        ? leg.attempts
        : leg.batchAnchor?.attempts
      )?.map(attempt => ({
        id: attempt.id,
        attemptNo: attempt.attemptNo,
        bolt11: attempt.bolt11,
        paymentHash: attempt.paymentHash,
        amountMsats: Number(attempt.amountMsats),
        requestId: attempt.requestId,
        status: attempt.status,
        preimage: attempt.preimage,
        routingFeeMsats:
          attempt.routingFeeMsats === null
            ? null
            : Number(attempt.routingFeeMsats),
        routingReserveMsats: Number(attempt.routingReserveMsats),
        errorCode: attempt.errorCode,
        errorMessage: attempt.errorMessage,
        expiresAt: attempt.expiresAt.toISOString(),
        createdAt: attempt.createdAt.toISOString(),
        resolvedAt: attempt.resolvedAt?.toISOString() ?? null
      }))
    }))
  }
}
