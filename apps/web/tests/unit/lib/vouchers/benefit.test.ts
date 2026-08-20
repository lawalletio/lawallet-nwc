import { describe, it, expect } from 'vitest'
import { formatBenefit, formatBenefitCap } from '@/lib/vouchers/benefit'

describe('formatBenefit', () => {
  it('summarizes each protocol benefit type', () => {
    expect(formatBenefit({ type: 'percent', percent: 20 })).toBe('20% off')
    expect(formatBenefit({ type: 'fixed', amount: 500, currency: 'ARS' })).toBe(
      '500.00 ARS off'
    )
    expect(
      formatBenefit({ type: 'fixed', amount: 1000, currency: 'SAT' })
    ).toBe('1,000 sats off')
    expect(formatBenefit({ type: 'multibuy', buyQty: 3, payQty: 2 })).toBe(
      '3 for the price of 2'
    )
    expect(
      formatBenefit({ type: 'buyXgetY', buyProductD: 'a', giftProductD: 'b' })
    ).toBe('Buy one, get one free')
    expect(
      formatBenefit({ type: 'freeItems', items: [{ d: 'a', qty: 2 }] })
    ).toBe('2 free items')
    expect(
      formatBenefit({ type: 'freeItems', items: [{ d: 'a', qty: 1 }] })
    ).toBe('1 free item')
  })

  it('returns null rather than guessing at an unknown benefit type', () => {
    // The upstream union grows; a wrong summary on a discount is worse than
    // none, and the UI falls back to showing the raw payload.
    expect(formatBenefit({ type: 'somethingNew', magic: 1 })).toBeNull()
    expect(formatBenefit(null)).toBeNull()
    expect(formatBenefit('20% off')).toBeNull()
    expect(formatBenefit({ type: 'freeItems', items: [] })).toBeNull()
  })
})

describe('formatBenefitCap', () => {
  it('renders a declared ceiling and nothing otherwise', () => {
    expect(
      formatBenefitCap({
        type: 'percent',
        percent: 50,
        cap: { amount: 2000, currency: 'SAT' }
      })
    ).toBe('up to 2,000 sats')
    expect(formatBenefitCap({ type: 'percent', percent: 50 })).toBeNull()
    expect(formatBenefitCap(null)).toBeNull()
  })
})
