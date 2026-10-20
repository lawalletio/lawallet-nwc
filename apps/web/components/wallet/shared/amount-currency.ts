import { parseKeypadValue } from '@/components/wallet/shared/amount-keypad'
import { convertSats, type BtcRates } from '@/lib/client/use-yadio-ticker'

export function keypadOptionsForCurrency(code: string): {
  integerOnly: boolean
  fixedDecimalDigits: number | undefined
  maxDecimalDigits: number | undefined
} {
  if (code === 'SAT') {
    return {
      integerOnly: true,
      fixedDecimalDigits: undefined,
      maxDecimalDigits: undefined
    }
  }
  if (code === 'BTC') {
    return {
      integerOnly: false,
      fixedDecimalDigits: undefined,
      maxDecimalDigits: 8
    }
  }
  return {
    integerOnly: false,
    fixedDecimalDigits: 2,
    maxDecimalDigits: undefined
  }
}

export function parseAmountToSats(
  raw: string,
  code: string,
  rates: BtcRates | null
): number | null {
  const value = parseKeypadValue(raw)
  if (value === null) return null
  if (code === 'SAT') return ceilPositiveSats(value)
  if (code === 'BTC') {
    return ceilPositiveSats(value * 100_000_000)
  }
  if (!rates) return null
  const rate = rates[code]
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    return null
  }
  return ceilPositiveSats((value / rate) * 100_000_000)
}

export function formatInputFromSats(
  sats: number | null,
  code: string,
  rates: BtcRates | null
): string {
  if (!sats || sats <= 0) return '0'
  if (code === 'SAT') return String(Math.trunc(sats))

  const converted = convertSats(sats, code, rates)
  if (converted === null) return '0'

  return code === 'BTC' ? trimFixed(converted, 8) : formatFiatInput(converted)
}

// More than all bitcoin that will ever exist (21M BTC) is not a real amount.
const MAX_SATS = 2_100_000_000_000_000

function ceilPositiveSats(rawSats: number): number | null {
  if (!Number.isFinite(rawSats) || rawSats <= 0 || rawSats > MAX_SATS) {
    return null
  }
  // Float noise grows with magnitude (1.1 × 1e8 = 110000000.00000001), so the
  // "already a whole sat" tolerance is relative. Mirrors the iOS PayAmount.sats.
  const rounded = Math.round(rawSats)
  const tolerance = Math.max(1e-9, rawSats * 1e-12)
  const sats =
    Math.abs(rawSats - rounded) < tolerance ? rounded : Math.ceil(rawSats)
  return Math.max(1, sats)
}

function formatFiatInput(value: number): string {
  const displayValue = value > 0 && value < 0.01 ? 0.01 : value
  return displayValue.toFixed(2)
}

function trimFixed(value: number, digits: number): string {
  const fixed = value.toFixed(digits)
  const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return trimmed || '0'
}
