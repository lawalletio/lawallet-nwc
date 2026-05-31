'use client'

import React from 'react'
import { ChevronDown, Star, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'

export type BindingTone = 'bound' | 'default' | 'none'

/**
 * Tappable "bound wallet" chip shown on each Address / Card row in the
 * mobile tabbed Connection Map. Tapping opens the wallet-picker bottom
 * sheet to rebind. The trailing chevron signals it's interactive.
 *
 * Tones:
 *   - bound   → a specific wallet (amber wallet icon, solid surface)
 *   - default → routes through the user's default wallet (star icon)
 *   - none    → idle / unbound (muted, dashed border)
 */
export function BindingChip({
  label,
  tone,
  onClick,
  disabled,
}: {
  label: string
  tone: BindingTone
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={e => {
        // Row taps open the detail dialog; the chip must not bubble up
        // to that handler or tapping the chip would do both.
        e.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      className={cn(
        'inline-flex max-w-[9.5rem] shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
        tone === 'bound' &&
          'border-border bg-secondary text-secondary-foreground hover:bg-secondary/80',
        tone === 'default' &&
          'border-border bg-secondary/60 text-secondary-foreground hover:bg-secondary/80',
        tone === 'none' &&
          'border-dashed border-border bg-transparent text-muted-foreground hover:bg-muted/50',
      )}
    >
      {tone === 'default' ? (
        <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
      ) : (
        <Wallet
          className={cn(
            'size-3 shrink-0',
            tone === 'bound' ? 'text-amber-400' : 'text-muted-foreground',
          )}
        />
      )}
      <span className="truncate">{label}</span>
      <ChevronDown className="size-3 shrink-0 opacity-60" />
    </button>
  )
}
