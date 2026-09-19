import { describe, expect, it } from 'vitest'
import { currencyUnitLabel, formatSatsAmount } from '@/lib/client/format-sats'

const RATES = { USD: 100_000 }

describe('currencyUnitLabel', () => {
  it('renders SAT as sats and other codes unchanged', () => {
    expect(currencyUnitLabel('SAT')).toBe('sats')
    expect(currencyUnitLabel('BTC')).toBe('BTC')
    expect(currencyUnitLabel('USD')).toBe('USD')
  })
})

describe('formatSatsAmount', () => {
  it('formats sats with thousands separators', () => {
    expect(formatSatsAmount(21000, 'SAT', RATES)).toBe('21,000')
  })

  it('formats BTC to 8 fractional digits', () => {
    expect(formatSatsAmount(21000, 'BTC', RATES)).toBe('0.00021000')
  })

  it('formats fiat to 2 fractional digits when the rate is known', () => {
    expect(formatSatsAmount(21000, 'USD', RATES)).toBe('21.00')
  })

  it('returns an em dash when a fiat rate is missing', () => {
    expect(formatSatsAmount(21000, 'USD', null)).toBe('—')
    expect(formatSatsAmount(21000, 'EUR', RATES)).toBe('—')
  })

  it('renders tiny fiat amounts as less than one cent', () => {
    expect(formatSatsAmount(3, 'USD', RATES)).toBe('< 0.01')
  })

  it('formats a zero fee as 0.00 in fiat instead of < 0.01', () => {
    expect(formatSatsAmount(0, 'USD', RATES)).toBe('0.00')
  })
})
