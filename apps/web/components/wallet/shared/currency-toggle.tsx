'use client'

import { cn } from '@/lib/utils'
import type { Currency } from '@/lib/client/currencies-store'

/**
 * Pill toggle for the wallet's active display currencies. Shared by the send
 * amount keypad and the send/receive receipts so those screens switch units
 * the same way.
 */
export function CurrencyToggle({
  currencies,
  value,
  onChange
}: {
  currencies: Currency[]
  value: string
  onChange: (next: string) => void
}) {
  if (currencies.length <= 1) return null

  return (
    <div
      role="group"
      aria-label="Display currency"
      className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-card p-1"
    >
      {currencies.map(currency => {
        const active = value === currency.code
        const label = currency.code === 'SAT' ? 'sats' : currency.code
        return (
          <button
            key={currency.code}
            type="button"
            onClick={() => onChange(currency.code)}
            aria-pressed={active}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
