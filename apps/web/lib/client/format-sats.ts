import { convertSats, type BtcRates } from '@/lib/client/use-yadio-ticker'

/** Display unit for a catalog currency code (`SAT` renders as `sats`). */
export function currencyUnitLabel(code: string): string {
  return code === 'SAT' ? 'sats' : code
}

/**
 * Formats a sats amount in the requested display currency. Returns `—` when a
 * fiat rate isn't available yet so the layout doesn't jump from `0` to the
 * real number. Tiny fiat values that would round to `0.00` render as `< 0.01`.
 */
export function formatSatsAmount(
  sats: number,
  code: string,
  rates: BtcRates | null
): string {
  const value = convertSats(sats, code, rates)
  if (value === null) return '—'
  if (code === 'SAT') return Math.round(value).toLocaleString()
  if (code === 'BTC') {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 8,
      maximumFractionDigits: 8
    })
  }
  if (value !== 0 && Math.abs(value) < 0.01) return '< 0.01'
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}
