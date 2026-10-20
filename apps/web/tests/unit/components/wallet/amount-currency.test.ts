import { describe, expect, it } from 'vitest'
import {
  formatInputFromSats,
  keypadOptionsForCurrency,
  parseAmountToSats
} from '@/components/wallet/shared/amount-currency'

const RATES = { USD: 100_000 }

describe('parseAmountToSats', () => {
  it('parses sats and bitcoin without a ticker', () => {
    expect(parseAmountToSats('2100', 'SAT', null)).toBe(2100)
    expect(parseAmountToSats('1', 'BTC', null)).toBe(100_000_000)
    expect(parseAmountToSats('0', 'SAT', null)).toBeNull()
  })

  it('converts fiat using the BTC rate table', () => {
    expect(parseAmountToSats('1.00', 'USD', RATES)).toBe(1000)
    expect(parseAmountToSats('1.00', 'USD', null)).toBeNull()
    expect(parseAmountToSats('1.00', 'USD', { USD: 0 })).toBeNull()
  })

  it('ceils sub-sat conversions up to one sat', () => {
    expect(parseAmountToSats('0.000000001', 'BTC', null)).toBe(1)
    expect(parseAmountToSats('0.01', 'USD', { USD: 3_000_000 })).toBe(1)
    expect(parseAmountToSats('0.0001', 'USD', RATES)).toBe(1)
  })

  it('ignores float noise on whole-sat amounts', () => {
    // 1.1 * 1e8 === 110000000.00000001 in floating point
    expect(parseAmountToSats('1.1', 'BTC', null)).toBe(110_000_000)
    expect(parseAmountToSats('20999999.12345678', 'BTC', null)).toBe(
      2_099_999_912_345_678
    )
  })

  it('rejects amounts above the 21M BTC supply', () => {
    expect(parseAmountToSats('21000000', 'BTC', null)).toBe(
      2_100_000_000_000_000
    )
    expect(parseAmountToSats('21000000.00000001', 'BTC', null)).toBeNull()
    expect(parseAmountToSats('1e300', 'BTC', null)).toBeNull()
    expect(parseAmountToSats('1e300', 'SAT', null)).toBeNull()
  })
})

describe('formatInputFromSats', () => {
  it('formats sats, bitcoin, and fiat for the keypad', () => {
    expect(formatInputFromSats(2100, 'SAT', null)).toBe('2100')
    expect(formatInputFromSats(100_000_000, 'BTC', null)).toBe('1')
    expect(formatInputFromSats(50_000_000, 'BTC', null)).toBe('0.5')
    expect(formatInputFromSats(1000, 'USD', RATES)).toBe('1.00')
  })

  it('falls back to 0 when a fiat rate is missing or the amount is empty', () => {
    expect(formatInputFromSats(null, 'USD', RATES)).toBe('0')
    expect(formatInputFromSats(1000, 'USD', null)).toBe('0')
  })

  it('never shows 0.00 for a tiny positive fiat amount', () => {
    expect(formatInputFromSats(1, 'USD', RATES)).toBe('0.01')
  })
})

describe('keypadOptionsForCurrency', () => {
  it('uses integer sats, 8-decimal bitcoin, and 2-decimal fiat', () => {
    expect(keypadOptionsForCurrency('SAT')).toEqual({
      integerOnly: true,
      fixedDecimalDigits: undefined,
      maxDecimalDigits: undefined
    })
    expect(keypadOptionsForCurrency('BTC')).toEqual({
      integerOnly: false,
      fixedDecimalDigits: undefined,
      maxDecimalDigits: 8
    })
    expect(keypadOptionsForCurrency('USD')).toEqual({
      integerOnly: false,
      fixedDecimalDigits: 2,
      maxDecimalDigits: undefined
    })
  })
})
