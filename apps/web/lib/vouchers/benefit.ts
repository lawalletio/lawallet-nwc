import type { VoucherBenefit } from '@/lib/client/hooks/use-vouchers'

/** `SAT` is whole sats upstream; fiat gets two decimals. */
function money(amount: number, currency: string): string {
  if (currency === 'SAT') return `${Math.round(amount).toLocaleString()} sats`
  return `${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ${currency}`
}

/**
 * One-line summary of a coupon benefit, for a card or a list row.
 *
 * Returns null for anything unrecognized rather than guessing — the protocol's
 * benefit union grows upstream, and a wrong summary on a discount is worse
 * than none. Callers fall back to showing the raw payload.
 */
export function formatBenefit(benefit: unknown): string | null {
  if (!benefit || typeof benefit !== 'object') return null
  const b = benefit as VoucherBenefit

  switch (b.type) {
    case 'percent':
      return `${b.percent}% off`
    case 'fixed':
      return `${money(b.amount, b.currency)} off`
    case 'multibuy':
      return `${b.buyQty} for the price of ${b.payQty}`
    case 'buyXgetY':
      return 'Buy one, get one free'
    case 'freeItems': {
      const count = Array.isArray(b.items)
        ? b.items.reduce((sum, item) => sum + (item.qty || 0), 0)
        : 0
      if (!count) return null
      return count === 1 ? '1 free item' : `${count} free items`
    }
    default:
      return null
  }
}

/** The benefit's spending ceiling, when it declares one. */
export function formatBenefitCap(benefit: unknown): string | null {
  if (!benefit || typeof benefit !== 'object') return null
  const cap = (benefit as VoucherBenefit).cap
  if (!cap || typeof cap.amount !== 'number' || !cap.currency) return null
  return `up to ${money(cap.amount, cap.currency)}`
}
