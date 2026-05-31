'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { useLiveRemoteWalletBalance } from '@/lib/client/hooks/use-remote-wallets'
import { useAnimatedNumber } from '@/lib/client/hooks/use-animated-number'

interface Props {
  /**
   * Wallet to fetch. Pass `null` for "no wallet behind this thing"
   * (REVOKED wallet, IDLE / ALIAS address) — the component still
   * renders the same `— sats` placeholder with a muted dot so the
   * layout stays stable, but skips the underlying fetch entirely.
   */
  walletId: string | null
  /**
   * Visual size — `sm` matches the inline third line on the wallet
   * canvas node (compact, muted), `md` is for dialog InfoFields
   * (regular text, slightly larger dot).
   */
  size?: 'sm' | 'md'
}

/**
 * Shared "live spendable balance + connection status" pill, used by:
 *   - `RemoteWalletNode` (inline 3rd line on the canvas, size="sm")
 *   - `WalletDetailDialog` (Balance InfoField, size="md")
 *   - `AddressDetailDialog` (Balance InfoField, size="md", routed
 *     through whichever wallet the LA binds to)
 *
 * Status dot semantics:
 *   - emerald, solid           : connected (fresh balance in hand)
 *   - amber, animate-pulse     : searching (first fetch in flight)
 *   - destructive, solid       : last fetch errored
 *   - muted-foreground, solid  : idle (walletId === null)
 *
 * The number itself rolls between the previous and new value via
 * `useAnimatedNumber` (odometer). `tabular-nums` keeps the digits
 * from dancing horizontally while the animation ticks.
 */
export function WalletLiveBalance({ walletId, size = 'md' }: Props) {
  const balance = useLiveRemoteWalletBalance(walletId)
  const animatedSats = useAnimatedNumber(balance.data?.balanceSats ?? null)

  const hasValue = walletId != null && balance.data != null
  const state: 'idle' | 'searching' | 'connected' | 'error' =
    walletId == null
      ? 'idle'
      : balance.error
        ? 'error'
        : hasValue
          ? 'connected'
          : 'searching'

  return (
    <span
      className={cn(
        'flex items-center tabular-nums',
        size === 'sm'
          ? 'gap-1.5 text-[10px] text-muted-foreground'
          : 'gap-2 text-sm',
      )}
      aria-label={`Balance ${state}`}
    >
      <span
        className={cn(
          'inline-block shrink-0 rounded-full',
          size === 'sm' ? 'size-1.5' : 'size-2',
          state === 'connected' && 'bg-emerald-400',
          state === 'searching' && 'animate-pulse bg-amber-400',
          state === 'error' && 'bg-destructive',
          state === 'idle' && 'bg-muted-foreground',
        )}
      />
      {hasValue ? `${animatedSats.toLocaleString()} sats` : '— sats'}
    </span>
  )
}
