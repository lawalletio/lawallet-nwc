import { describe, expect, it } from 'vitest'
import {
  calculateProxyAmounts,
  grossRangeForDestination
} from '@/lib/proxy/money'

describe('deferred proxy money', () => {
  it('charges the default 0.5% fee in integer millisatoshis', () => {
    expect(calculateProxyAmounts(100_000, 50)).toEqual({
      grossAmountMsats: 100_000,
      serviceFeeMsats: 500,
      destinationAmountMsats: 99_500
    })
  })

  it('rounds the service fee up to the next millisatoshi', () => {
    expect(calculateProxyAmounts(1_001, 50)).toEqual({
      grossAmountMsats: 1_001,
      serviceFeeMsats: 6,
      destinationAmountMsats: 995
    })
  })

  it('uses exact arithmetic for large safe-integer amounts', () => {
    const gross = 9_000_000_000_000
    const result = calculateProxyAmounts(gross, 50)
    expect(result.serviceFeeMsats).toBe(45_000_000_000)
    expect(result.destinationAmountMsats).toBe(8_955_000_000_000)
  })

  it('maps the destination range to a gross range without admitting an invalid net amount', () => {
    const range = grossRangeForDestination(1_000, 10_000, 50)
    expect(
      calculateProxyAmounts(range.minSendable, 50).destinationAmountMsats
    ).toBeGreaterThanOrEqual(1_000)
    expect(
      calculateProxyAmounts(range.maxSendable, 50).destinationAmountMsats
    ).toBeLessThanOrEqual(10_000)
    expect(
      calculateProxyAmounts(range.maxSendable + 1, 50).destinationAmountMsats
    ).toBeGreaterThan(10_000)
  })
})
