import { MAX_PROXY_FEE_BPS } from './constants'

export interface ProxyAmounts {
  grossAmountMsats: number
  serviceFeeMsats: number
  destinationAmountMsats: number
}

export function calculateProxyAmounts(
  grossAmountMsats: number,
  feeBps: number
): ProxyAmounts {
  if (!Number.isSafeInteger(grossAmountMsats) || grossAmountMsats <= 0) {
    throw new TypeError('grossAmountMsats must be a positive safe integer')
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_PROXY_FEE_BPS) {
    throw new TypeError(
      `feeBps must be an integer between 0 and ${MAX_PROXY_FEE_BPS}`
    )
  }
  const serviceFeeMsats = Number(
    ceilDivide(BigInt(grossAmountMsats) * BigInt(feeBps), BigInt(10_000))
  )
  const destinationAmountMsats = grossAmountMsats - serviceFeeMsats
  if (destinationAmountMsats <= 0) {
    throw new TypeError('Proxy fee leaves no destination amount')
  }
  return { grossAmountMsats, serviceFeeMsats, destinationAmountMsats }
}

function netAmount(gross: number, feeBps: number): number {
  return (
    gross - Number(ceilDivide(BigInt(gross) * BigInt(feeBps), BigInt(10_000)))
  )
}

/** Maps a destination-net LNURL range to the payer-facing gross range. */
export function grossRangeForDestination(
  minDestinationMsats: number,
  maxDestinationMsats: number,
  feeBps: number
): { minSendable: number; maxSendable: number } {
  if (
    !Number.isSafeInteger(minDestinationMsats) ||
    !Number.isSafeInteger(maxDestinationMsats) ||
    minDestinationMsats <= 0 ||
    maxDestinationMsats < minDestinationMsats ||
    maxDestinationMsats >= Number.MAX_SAFE_INTEGER
  ) {
    throw new TypeError('Destination amount range is invalid')
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_PROXY_FEE_BPS) {
    throw new TypeError(
      `feeBps must be an integer between 0 and ${MAX_PROXY_FEE_BPS}`
    )
  }

  const findFirst = (target: number) => {
    let low = 1
    const highBig =
      ceilDivide(BigInt(target) * BigInt(10_000), BigInt(10_000 - feeBps)) +
      BigInt(2)
    if (highBig > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TypeError('Gross proxy amount exceeds safe integer range')
    }
    let high = Number(highBig)
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (netAmount(mid, feeBps) >= target) high = mid
      else low = mid + 1
    }
    return low
  }

  const minSendable = findFirst(minDestinationMsats)
  const firstAboveMax = findFirst(maxDestinationMsats + 1)
  return { minSendable, maxSendable: firstAboveMax - 1 }
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - BigInt(1)) / denominator
}
