import type { RemoteWallet } from '@/lib/generated/prisma'
import { eventBus } from '@/lib/events/event-bus'
import { parseExactPaymentInvoice } from '@/lib/invoice-utils'
import { prisma } from '@/lib/prisma'
import { MAX_PROXY_FEE_BPS } from '@/lib/proxy/constants'
import { parseLightningAddress } from '@/lib/wallet/resolve-payment-route'
import {
  ConflictError,
  NotFoundError,
  ValidationError
} from '@/types/server/errors'
import {
  allocateForwardingAmounts,
  calculateForwardingAmounts,
  DEFAULT_REMOTE_WALLET_FORWARD_BASE_FEE_SATS,
  DEFAULT_REMOTE_WALLET_FORWARD_FEE_BPS,
  REMOTE_WALLET_ROUTING_RESERVE_BASE_SATS,
  REMOTE_WALLET_ROUTING_RESERVE_BPS,
  type ForwardingDestinationInput,
  validateDestinations
} from './money'

const OPEN_RECEIPT_STATUSES = [
  'RECEIVED',
  'FORWARDING',
  'PARTIAL',
  'BLOCKED'
] as const

export interface ReceiveActionConfigInput {
  feeBps?: number
  baseFeeSats?: number
  enabled?: boolean
  destinations: ForwardingDestinationInput[]
}

export interface CapturedPayment {
  eventKey: string
  walletId: string
  receivedAt: number
  recovered?: boolean
  payment: {
    paymentHash: string
    amountMsats?: number
    settledAt?: number
    invoice?: string
  }
}

export async function loadOwnedRemoteWallet(
  walletId: string,
  userId: string
): Promise<RemoteWallet> {
  const wallet = await prisma.remoteWallet.findUnique({
    where: { id: walletId }
  })
  if (!wallet || wallet.userId !== userId) {
    throw new NotFoundError('Wallet not found')
  }
  return wallet
}

function remoteWalletForwardingEligibility(wallet: RemoteWallet): {
  eligible: boolean
  reason: string | null
} {
  if (wallet.status !== 'ACTIVE') {
    return { eligible: false, reason: 'Wallet must be active' }
  }
  if (wallet.type !== 'NWC') {
    return { eligible: false, reason: 'Only NWC wallets are supported' }
  }
  const mode = (wallet.config as { mode?: unknown } | null)?.mode
  if (mode !== 'SEND_RECEIVE') {
    return {
      eligible: false,
      reason: 'Wallet must allow both sending and receiving'
    }
  }
  return { eligible: true, reason: null }
}

export async function getReceiveActionDto(walletId: string, userId: string) {
  const wallet = await loadOwnedRemoteWallet(walletId, userId)
  const action = await prisma.remoteWalletReceiveAction.findUnique({
    where: { remoteWalletId: walletId },
    include: {
      currentRevision: {
        include: { destinations: { orderBy: { position: 'asc' } } }
      }
    }
  })
  const pendingReceipts = action
    ? await prisma.remoteWalletForwardReceipt.findMany({
        where: {
          actionId: action.id,
          status: { in: [...OPEN_RECEIPT_STATUSES] }
        },
        select: {
          targetAmountMsats: true,
          legs: {
            where: { status: { notIn: ['SUCCEEDED', 'SUPERSEDED'] } },
            select: { requestedAmountMsats: true }
          }
        }
      })
    : []
  // Residual legs park an unused routing reserve on a receipt that has already
  // completed. They are still owed to the destination, so they count as pending.
  const carriedLegs = action
    ? await prisma.remoteWalletForwardLeg.findMany({
        where: {
          receipt: {
            actionId: action.id,
            status: { notIn: [...OPEN_RECEIPT_STATUSES] }
          },
          status: { notIn: ['SUCCEEDED', 'SUPERSEDED'] }
        },
        select: { requestedAmountMsats: true }
      })
    : []
  const pendingAmount = pendingReceipts.reduce(
    (receiptSum, receipt) =>
      receiptSum +
      (receipt.legs.length > 0
        ? receipt.legs.reduce(
            (legSum, leg) => legSum + leg.requestedAmountMsats,
            BigInt(0)
          )
        : receipt.targetAmountMsats),
    carriedLegs.reduce((sum, leg) => sum + leg.requestedAmountMsats, BigInt(0))
  )
  const eligibility = remoteWalletForwardingEligibility(wallet)

  return {
    walletId,
    ...eligibility,
    configured: Boolean(action?.currentRevision),
    enabled: action?.enabled ?? false,
    enabledAt: action?.enabledAt?.toISOString() ?? null,
    pausedAt: action?.pausedAt?.toISOString() ?? null,
    pendingReceipts: pendingReceipts.length,
    pendingAmountMsats: Number(pendingAmount),
    routingReserveBps: REMOTE_WALLET_ROUTING_RESERVE_BPS,
    routingReserveBaseSats: REMOTE_WALLET_ROUTING_RESERVE_BASE_SATS,
    revision: action?.currentRevision
      ? {
          number: action.currentRevision.revision,
          feeBps: action.currentRevision.feeBps,
          // Configured in whole sats, so this never loses precision; dividing
          // after the Number cast keeps a sub-sat legacy value visible.
          baseFeeSats: Number(action.currentRevision.baseFeeMsats) / 1000,
          destinations: action.currentRevision.destinations.map(
            destination => ({
              address: destination.address,
              allocationBps: destination.allocationBps
            })
          )
        }
      : null
  }
}

export async function putReceiveAction(
  walletId: string,
  userId: string,
  input: ReceiveActionConfigInput
) {
  const wallet = await loadOwnedRemoteWallet(walletId, userId)
  const eligibility = remoteWalletForwardingEligibility(wallet)
  if (!eligibility.eligible) throw new ValidationError(eligibility.reason!)

  const destinations = input.destinations.map(destination => ({
    address: destination.address.trim().toLowerCase(),
    allocationBps: destination.allocationBps
  }))
  try {
    validateDestinations(destinations)
  } catch (error) {
    throw new ValidationError(
      error instanceof Error ? error.message : 'Invalid destinations'
    )
  }
  for (const destination of destinations) {
    if (!parseLightningAddress(destination.address)) {
      throw new ValidationError(
        `Invalid Lightning Address: ${destination.address}`
      )
    }
  }
  const feeBps = input.feeBps ?? DEFAULT_REMOTE_WALLET_FORWARD_FEE_BPS
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_PROXY_FEE_BPS) {
    throw new ValidationError(
      `feeBps must be between 0 and ${MAX_PROXY_FEE_BPS}`
    )
  }
  const baseFeeSats =
    input.baseFeeSats ?? DEFAULT_REMOTE_WALLET_FORWARD_BASE_FEE_SATS
  if (!Number.isSafeInteger(baseFeeSats) || baseFeeSats < 0) {
    throw new ValidationError('baseFeeSats must be a nonnegative integer')
  }
  const baseFeeMsats = BigInt(baseFeeSats) * BigInt(1000)

  await prisma.$transaction(async tx => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${walletId}, 0))
    `
    const currentWallet = await tx.remoteWallet.findUnique({
      where: { id: walletId }
    })
    if (!currentWallet || currentWallet.userId !== userId) {
      throw new NotFoundError('Wallet not found')
    }
    const currentEligibility = remoteWalletForwardingEligibility(currentWallet)
    if (!currentEligibility.eligible) {
      throw new ValidationError(currentEligibility.reason!)
    }
    const existingAction = await tx.remoteWalletReceiveAction.findUnique({
      where: { remoteWalletId: walletId },
      select: { id: true, enabled: true, enabledAt: true }
    })
    const nextEnabled = input.enabled ?? existingAction?.enabled ?? false
    let actionId = existingAction?.id
    let nextRevision = 1
    if (existingAction) {
      actionId = existingAction.id
      const uncertain = await tx.remoteWalletForwardAttempt.count({
        where: {
          leg: { receipt: { actionId } },
          OR: [
            { status: { in: ['PENDING', 'UNKNOWN'] } },
            // A settled attempt whose batch has not been credited yet would
            // lose its payment if we superseded those legs now.
            {
              status: 'SUCCEEDED',
              leg: { status: { notIn: ['SUCCEEDED', 'SUPERSEDED'] } }
            }
          ]
        }
      })
      if (uncertain > 0) {
        throw new ConflictError(
          'A forwarding payment still has an unknown outcome; wait for it to resolve'
        )
      }
      const latest = await tx.remoteWalletReceiveActionRevision.aggregate({
        where: { actionId },
        _max: { revision: true }
      })
      nextRevision = (latest._max.revision ?? 0) + 1
    } else {
      const created = await tx.remoteWalletReceiveAction.create({
        data: { remoteWalletId: walletId, enabled: false, pausedAt: new Date() }
      })
      actionId = created.id
    }

    const revision = await tx.remoteWalletReceiveActionRevision.create({
      data: {
        actionId,
        revision: nextRevision,
        feeBps,
        baseFeeMsats,
        destinations: {
          create: destinations.map((destination, position) => ({
            position,
            address: destination.address,
            allocationBps: destination.allocationBps
          }))
        }
      }
    })

    const receipts = await tx.remoteWalletForwardReceipt.findMany({
      where: { actionId, status: { in: [...OPEN_RECEIPT_STATUSES] } },
      include: { legs: true }
    })
    for (const receipt of receipts) {
      const succeededLegs = receipt.legs.filter(
        leg => leg.status === 'SUCCEEDED'
      )
      const paid = succeededLegs.reduce(
        (sum, leg) => sum + (leg.forwardedAmountMsats ?? BigInt(0)),
        BigInt(0)
      )
      const fulfilled = succeededLegs.reduce(
        (sum, leg) => sum + leg.requestedAmountMsats,
        BigInt(0)
      )
      if (receipt.grossAmountMsats === BigInt(0)) {
        await tx.remoteWalletForwardLeg.updateMany({
          where: { receiptId: receipt.id, status: { not: 'SUCCEEDED' } },
          data: { status: 'SUPERSEDED', supersededAt: new Date() }
        })
        await tx.remoteWalletForwardReceipt.update({
          where: { id: receipt.id },
          data: {
            revisionId: revision.id,
            configRevision: nextRevision,
            status: 'BLOCKED',
            lastError: 'Source payment amount is not available yet',
            nextRetryAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null
          }
        })
        continue
      }
      const amounts = calculateForwardingAmounts(
        receipt.grossAmountMsats,
        feeBps,
        baseFeeMsats
      )
      if (amounts.targetAmountMsats < fulfilled) {
        throw new ConflictError(
          'The new fee would make an existing receipt owe less than its completed legs'
        )
      }
      await tx.remoteWalletForwardLeg.updateMany({
        where: { receiptId: receipt.id, status: { not: 'SUCCEEDED' } },
        data: { status: 'SUPERSEDED', supersededAt: new Date() }
      })
      // A destination shortfall (up to 10 sats) is retained and audited; it
      // has already fulfilled that leg and must not be redistributed.
      const remaining = amounts.targetAmountMsats - fulfilled
      const nextPosition =
        receipt.legs.reduce((max, leg) => Math.max(max, leg.position), -1) + 1
      const allocations = allocateForwardingAmounts(
        remaining,
        destinations
      ).filter(allocation => allocation.amountMsats > BigInt(0))
      const canCreateLegs = remaining > BigInt(0)
      if (canCreateLegs) {
        await tx.remoteWalletForwardLeg.createMany({
          data: allocations.map(allocation => ({
            receiptId: receipt.id,
            position: nextPosition + allocation.position,
            destination: allocation.address,
            allocationBps: allocation.allocationBps,
            requestedAmountMsats: allocation.amountMsats,
            routingReserveMsats: BigInt(0)
          }))
        })
      }
      await tx.remoteWalletForwardReceipt.update({
        where: { id: receipt.id },
        data: {
          revisionId: revision.id,
          configRevision: nextRevision,
          retainedFeeMsats: amounts.retainedFeeMsats,
          targetAmountMsats: amounts.targetAmountMsats,
          forwardedAmountMsats: paid,
          routingReserveMsats: succeededLegs.reduce(
            (sum, leg) => sum + leg.routingReserveMsats,
            BigInt(0)
          ),
          status:
            remaining === BigInt(0)
              ? 'COMPLETED'
              : canCreateLegs
                ? paid > BigInt(0)
                  ? 'PARTIAL'
                  : 'RECEIVED'
                : 'RECEIVED',
          lastError: null,
          nextRetryAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: remaining === BigInt(0) ? new Date() : null
        }
      })
    }

    await tx.remoteWalletReceiveAction.update({
      where: { id: actionId },
      data: {
        currentRevisionId: revision.id,
        enabled: nextEnabled,
        enabledAt: nextEnabled
          ? (existingAction?.enabledAt ?? activationTime())
          : (existingAction?.enabledAt ?? null),
        pausedAt: nextEnabled ? null : new Date()
      }
    })
  })
  emitForwardingUpdated()
  return getReceiveActionDto(walletId, userId)
}

export async function setReceiveActionEnabled(
  walletId: string,
  userId: string,
  enabled: boolean
) {
  await loadOwnedRemoteWallet(walletId, userId)
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${walletId}, 0))
    `
    const wallet = await tx.remoteWallet.findUnique({ where: { id: walletId } })
    if (!wallet || wallet.userId !== userId) {
      throw new NotFoundError('Wallet not found')
    }
    if (enabled) {
      const eligibility = remoteWalletForwardingEligibility(wallet)
      if (!eligibility.eligible) throw new ValidationError(eligibility.reason!)
    }
    const action = await tx.remoteWalletReceiveAction.findUnique({
      where: { remoteWalletId: walletId }
    })
    if (!action?.currentRevisionId) {
      throw new ValidationError('Configure forwarding destinations first')
    }
    await tx.remoteWalletReceiveAction.update({
      where: { id: action.id },
      data: {
        enabled,
        enabledAt: enabled ? activationTime() : action.enabledAt,
        pausedAt: enabled ? null : new Date()
      }
    })
  })
  emitForwardingUpdated()
  return getReceiveActionDto(walletId, userId)
}

export async function captureForwardingReceipt(
  event: CapturedPayment
): Promise<string | null> {
  const receiptId = await prisma.$transaction(async tx => {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${event.walletId}, 0))
    `
    const action = await tx.remoteWalletReceiveAction.findUnique({
      where: { remoteWalletId: event.walletId },
      include: {
        remoteWallet: true,
        currentRevision: {
          include: { destinations: { orderBy: { position: 'asc' } } }
        }
      }
    })
    if (
      !action?.enabled ||
      !action.enabledAt ||
      !action.currentRevision ||
      action.remoteWallet.status !== 'ACTIVE'
    ) {
      return null
    }
    const settledAt = event.payment.settledAt
      ? new Date(event.payment.settledAt * 1000)
      : new Date(event.receivedAt)
    if (settledAt < action.enabledAt) return null

    let grossAmountMsats = event.payment.amountMsats ?? 0
    if (!grossAmountMsats && event.payment.invoice) {
      try {
        grossAmountMsats = parseExactPaymentInvoice(
          event.payment.invoice
        ).amountMsats
      } catch {
        // Keep a BLOCKED receipt: the reconciler can recover the amount with
        // lookup_invoice without losing the listener event.
      }
    }
    const gross = BigInt(grossAmountMsats)
    const amounts =
      gross > BigInt(0)
        ? calculateForwardingAmounts(
            gross,
            action.currentRevision.feeBps,
            action.currentRevision.baseFeeMsats
          )
        : {
            grossAmountMsats: BigInt(0),
            retainedFeeMsats: BigInt(0),
            targetAmountMsats: BigInt(0)
          }
    const destinations = action.currentRevision.destinations.map(
      destination => ({
        address: destination.address,
        allocationBps: destination.allocationBps
      })
    )
    const allocations =
      amounts.targetAmountMsats > BigInt(0)
        ? allocateForwardingAmounts(
            amounts.targetAmountMsats,
            destinations
          ).filter(allocation => allocation.amountMsats > BigInt(0))
        : []
    const status =
      gross === BigInt(0)
        ? 'BLOCKED'
        : amounts.targetAmountMsats === BigInt(0)
          ? 'RETAINED'
          : 'RECEIVED'

    try {
      const receipt = await tx.remoteWalletForwardReceipt.create({
        data: {
          actionId: action.id,
          revisionId: action.currentRevision.id,
          walletId: event.walletId,
          userId: action.remoteWallet.userId,
          eventKey: event.eventKey,
          sourcePaymentHash: event.payment.paymentHash.toLowerCase(),
          sourceInvoice: event.payment.invoice,
          grossAmountMsats: amounts.grossAmountMsats,
          retainedFeeMsats: amounts.retainedFeeMsats,
          targetAmountMsats: amounts.targetAmountMsats,
          routingReserveMsats: BigInt(0),
          configRevision: action.currentRevision.revision,
          status,
          recovered: event.recovered ?? false,
          sourceSettledAt: settledAt,
          completedAt: status === 'RETAINED' ? new Date() : undefined,
          lastError:
            gross === BigInt(0)
              ? 'Incoming payment amount was not reported; awaiting wallet lookup'
              : null,
          legs:
            status === 'RECEIVED'
              ? {
                  create: allocations.map(allocation => ({
                    position: allocation.position,
                    destination: allocation.address,
                    allocationBps: allocation.allocationBps,
                    requestedAmountMsats: allocation.amountMsats,
                    routingReserveMsats: BigInt(0)
                  }))
                }
              : undefined
        }
      })
      return receipt.id
    } catch (error) {
      if (isUniqueConstraint(error)) return null
      throw error
    }
  })
  if (receiptId) emitForwardingUpdated()
  return receiptId
}

export function emitForwardingUpdated(): void {
  eventBus.emit({
    type: 'remote-wallet-forwarding:updated',
    timestamp: Date.now()
  })
}

function isUniqueConstraint(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  )
}

// NIP-47 settlement timestamps have one-second precision. Persist the
// activation boundary at the same precision so a payment settled immediately
// after resume is not incorrectly classified as historical.
function activationTime(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000)
}
