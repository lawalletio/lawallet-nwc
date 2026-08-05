import { describe, expect, it } from 'vitest'
import {
  allocateForwardingAmounts,
  calculateForwardingAmounts,
  calculateRoutingReserve,
  validateDestinations
} from '@/lib/remote-wallet-forwarding/money'
import { isDestinationInvoiceAmountAcceptable } from '@/lib/proxy/money'

describe('remote wallet forwarding money', () => {
  it('retains the percentage fee rounded up plus the fixed fee', () => {
    expect(
      calculateForwardingAmounts(BigInt(100_001), 50, BigInt(1_000))
    ).toEqual({
      grossAmountMsats: BigInt(100_001),
      retainedFeeMsats: BigInt(1_501),
      targetAmountMsats: BigInt(98_500)
    })
  })

  it('retains the whole receipt when fees consume the gross amount', () => {
    expect(
      calculateForwardingAmounts(BigInt(1_000), 50, BigInt(1_000))
    ).toEqual({
      grossAmountMsats: BigInt(1_000),
      retainedFeeMsats: BigInt(1_000),
      targetAmountMsats: BigInt(0)
    })
  })

  it('reserves one percent rounded up to sats plus one sat', () => {
    expect(calculateRoutingReserve(BigInt(9_949_000))).toEqual({
      requestedAmountMsats: BigInt(9_949_000),
      routingReserveMsats: BigInt(101_000),
      invoiceAmountMsats: BigInt(9_848_000)
    })
  })

  it('increases the reserve deterministically after a terminal rejection', () => {
    expect(calculateRoutingReserve(BigInt(9_949_000), 2)).toEqual({
      requestedAmountMsats: BigInt(9_949_000),
      routingReserveMsats: BigInt(202_000),
      invoiceAmountMsats: BigInt(9_747_000)
    })
  })

  it('allocates every millisatoshi with deterministic largest remainders', () => {
    const allocations = allocateForwardingAmounts(BigInt(10_001), [
      { address: 'first@example.com', allocationBps: 3_333 },
      { address: 'second@example.com', allocationBps: 3_333 },
      { address: 'third@example.com', allocationBps: 3_334 }
    ])

    expect(allocations.map(allocation => allocation.amountMsats)).toEqual([
      BigInt(3_333),
      BigInt(3_333),
      BigInt(3_335)
    ])
    expect(
      allocations.reduce(
        (sum, allocation) => sum + allocation.amountMsats,
        BigInt(0)
      )
    ).toBe(BigInt(10_001))
  })

  it('requires unique destinations totaling exactly 100 percent', () => {
    expect(() =>
      validateDestinations([
        { address: 'one@example.com', allocationBps: 5_000 },
        { address: 'two@example.com', allocationBps: 4_999 }
      ])
    ).toThrow('total 10000 bps')
    expect(() =>
      validateDestinations([
        { address: 'same@example.com', allocationBps: 5_000 },
        { address: 'SAME@example.com', allocationBps: 5_000 }
      ])
    ).toThrow('unique')
  })

  it('accepts a destination invoice up to 10 sats lower but never higher', () => {
    expect(isDestinationInvoiceAmountAcceptable(100_000, 90_000)).toBe(true)
    expect(isDestinationInvoiceAmountAcceptable(100_000, 89_999)).toBe(false)
    expect(isDestinationInvoiceAmountAcceptable(100_000, 100_001)).toBe(false)
  })
})
