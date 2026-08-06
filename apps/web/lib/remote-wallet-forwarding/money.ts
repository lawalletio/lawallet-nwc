import { MAX_PROXY_FEE_BPS } from '@/lib/proxy/constants'
import { ceilDivide } from '@/lib/proxy/money'

export const DEFAULT_REMOTE_WALLET_FORWARD_FEE_BPS = 50
export const DEFAULT_REMOTE_WALLET_FORWARD_BASE_FEE_SATS = 1
export const REMOTE_WALLET_ROUTING_RESERVE_BPS = 100
export const REMOTE_WALLET_ROUTING_RESERVE_BASE_SATS = 1
export const TOTAL_ALLOCATION_BPS = 10_000
export const FORWARDING_AMOUNT_TOO_SMALL_ERROR =
  'Pending amount is too small to forward. It will be retried when more funds arrive.'
const MSATS_PER_SAT = BigInt(1000)

export interface ForwardingAmounts {
  grossAmountMsats: bigint
  retainedFeeMsats: bigint
  targetAmountMsats: bigint
}

export interface ForwardingAllocation {
  position: number
  address: string
  allocationBps: number
  amountMsats: bigint
}

export interface RoutingReserveAmounts {
  requestedAmountMsats: bigint
  routingReserveMsats: bigint
  invoiceAmountMsats: bigint
}

export interface ForwardingDestinationInput {
  address: string
  allocationBps: number
}

export function calculateForwardingAmounts(
  grossAmountMsats: bigint,
  feeBps: number,
  baseFeeMsats: bigint
): ForwardingAmounts {
  if (grossAmountMsats <= 0) {
    throw new TypeError('grossAmountMsats must be positive')
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_PROXY_FEE_BPS) {
    throw new TypeError(`feeBps must be between 0 and ${MAX_PROXY_FEE_BPS}`)
  }
  if (baseFeeMsats < 0) {
    throw new TypeError('baseFeeMsats must be nonnegative')
  }

  const percentageFee = ceilDivide(
    grossAmountMsats * BigInt(feeBps),
    BigInt(TOTAL_ALLOCATION_BPS)
  )
  const requestedFee = percentageFee + baseFeeMsats
  const retainedFeeMsats =
    requestedFee >= grossAmountMsats ? grossAmountMsats : requestedFee

  return {
    grossAmountMsats,
    retainedFeeMsats,
    targetAmountMsats: grossAmountMsats - retainedFeeMsats
  }
}

/**
 * Keep a deterministic routing allowance in the source wallet before asking
 * the destination for an invoice. The percentage component is rounded up to
 * a whole satoshi, then the one-sat base is added. Escalation after a terminal
 * insufficient balance rejection is handled by the reconciler.
 */
export function calculateRoutingReserve(
  requestedAmountMsats: bigint
): RoutingReserveAmounts {
  if (requestedAmountMsats <= BigInt(0)) {
    throw new TypeError('requestedAmountMsats must be positive')
  }

  const percentageSats = ceilDivide(
    requestedAmountMsats * BigInt(REMOTE_WALLET_ROUTING_RESERVE_BPS),
    BigInt(TOTAL_ALLOCATION_BPS) * MSATS_PER_SAT
  )
  const requestedReserve =
    (percentageSats + BigInt(REMOTE_WALLET_ROUTING_RESERVE_BASE_SATS)) *
    MSATS_PER_SAT
  const routingReserveMsats =
    requestedReserve >= requestedAmountMsats
      ? requestedAmountMsats
      : requestedReserve

  return {
    requestedAmountMsats,
    routingReserveMsats,
    invoiceAmountMsats: requestedAmountMsats - routingReserveMsats
  }
}

/**
 * Largest-remainder apportionment. Shares always sum back to `total`, ties
 * break on the caller's ordering, and no step touches floating point.
 */
export function largestRemainderShares(
  total: bigint,
  weights: bigint[]
): bigint[] {
  const shares = weights.map(() => BigInt(0))
  if (total === BigInt(0) || weights.length === 0) return shares
  const weightTotal = weights.reduce((sum, weight) => sum + weight, BigInt(0))
  if (weightTotal <= BigInt(0)) {
    throw new TypeError('Allocation weights must sum to a positive value')
  }
  const ranked = weights.map((weight, index) => {
    const numerator = total * weight
    shares[index] = numerator / weightTotal
    return { index, remainder: numerator % weightTotal }
  })
  let distributed = shares.reduce((sum, share) => sum + share, BigInt(0))
  ranked.sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1
  )
  // Flooring loses at most weights.length - 1 msats, so one pass always closes
  // the gap.
  for (const row of ranked) {
    if (distributed >= total) break
    shares[row.index] += BigInt(1)
    distributed += BigInt(1)
  }
  if (distributed !== total) {
    throw new Error('Allocation did not preserve the total amount')
  }
  return shares
}

/**
 * Largest-remainder allocation with stable position tie-breaking. The result
 * always sums to targetAmountMsats and never relies on floating-point math.
 */
export function allocateForwardingAmounts(
  targetAmountMsats: bigint,
  destinations: ForwardingDestinationInput[]
): ForwardingAllocation[] {
  validateDestinations(destinations)
  if (targetAmountMsats < 0) {
    throw new TypeError('targetAmountMsats must be nonnegative')
  }

  const shares = largestRemainderShares(
    targetAmountMsats,
    destinations.map(destination => BigInt(destination.allocationBps))
  )
  return destinations.map((destination, position) => ({
    position,
    address: destination.address,
    allocationBps: destination.allocationBps,
    amountMsats: shares[position]
  }))
}

export function validateDestinations(
  destinations: ForwardingDestinationInput[]
): void {
  if (destinations.length === 0) {
    throw new TypeError('At least one destination is required')
  }
  const addresses = new Set<string>()
  let total = 0
  for (const destination of destinations) {
    const address = destination.address.trim().toLowerCase()
    if (!address || addresses.has(address)) {
      throw new TypeError('Forwarding destinations must be unique')
    }
    addresses.add(address)
    if (
      !Number.isInteger(destination.allocationBps) ||
      destination.allocationBps <= 0 ||
      destination.allocationBps > TOTAL_ALLOCATION_BPS
    ) {
      throw new TypeError('allocationBps must be between 1 and 10000')
    }
    total += destination.allocationBps
  }
  if (total !== TOTAL_ALLOCATION_BPS) {
    throw new TypeError('Forwarding allocations must total 10000 bps')
  }
}
