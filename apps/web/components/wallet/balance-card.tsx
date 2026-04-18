'use client'

import React from 'react'
import Image from 'next/image'
import { RefreshCw, WifiOff, Loader2 } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { useNwcBalance, nwcStatusLabel } from '@/lib/client/use-nwc-balance'

export interface BalanceCardProps {
  /**
   * The NWC connection string this address resolves to. Pass `null` when
   * the address mode has no working NWC (IDLE / ALIAS / unconfigured) —
   * the card renders its own empty state in that case.
   */
  connectionString: string | null
  /** Short explanation for why there is no NWC. Used inside the empty state. */
  emptyReason?: string
  /**
   * Optional icon to show in the empty-state tile. Defaults to the NWC
   * logo; callers can swap in a mode-appropriate icon (e.g. `<Forward>`
   * for ALIAS addresses) so the visual matches the message.
   */
  emptyIcon?: React.ReactNode
}

/** Default empty-state icon — the generic NWC logo. */
const DefaultEmptyIcon = (
  <Image
    src="/logos/nwc.svg"
    alt="NWC"
    width={24}
    height={24}
    className="size-6 opacity-40"
  />
)

/**
 * Shows the live balance of an NWC wallet tied to the current address.
 * Small variant of the dashboard NwcCard — keeps the same visual language
 * (yellow accent card, inline status indicator, refresh button) but sized
 * for an address-detail page where the balance is context, not the hero.
 */
export function BalanceCard({
  connectionString,
  emptyReason,
  emptyIcon,
}: BalanceCardProps) {
  const balance = useNwcBalance(connectionString)

  if (!connectionString) {
    // Nullish-coalesce in the JSX so an explicit `emptyIcon={undefined}`
    // passed from a conditional caller (e.g. `mode === 'ALIAS' ? … :
    // undefined`) still gets the default icon, instead of rendering a
    // hole where the tile should be.
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-5 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          {emptyIcon ?? DefaultEmptyIcon}
        </div>
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Balance
          </span>
          <span className="text-sm text-muted-foreground">
            {emptyReason ?? 'Not available for this mode.'}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-yellow-500/20 bg-gradient-to-br from-yellow-500/15 via-yellow-500/5 to-transparent px-5 py-5">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#897FFF]/10">
          <Image
            src="/logos/nwc.svg"
            alt="NWC"
            width={28}
            height={28}
            className="size-7"
          />
        </div>
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Balance
          </span>
          <span className="text-xs text-muted-foreground">
            {nwcStatusLabel(balance.status)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {balance.sats !== null ? (
          <span className="text-3xl font-semibold tabular-nums leading-none">
            {balance.sats.toLocaleString()}
            <span className="ml-1.5 text-sm text-muted-foreground font-normal">
              sats
            </span>
          </span>
        ) : balance.error ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
            <WifiOff className="size-3.5" />
            Unavailable
          </span>
        ) : (
          <Spinner size={24} className="text-muted-foreground" />
        )}
        <button
          type="button"
          onClick={balance.refetch}
          disabled={balance.loading}
          aria-label="Refresh balance"
          title="Refresh balance"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
        >
          {balance.loading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
        </button>
      </div>
    </div>
  )
}
