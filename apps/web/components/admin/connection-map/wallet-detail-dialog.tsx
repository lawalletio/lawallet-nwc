'use client'

import React from 'react'
import Link from 'next/link'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  Star,
  Wallet,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/client/format'
import {
  useLiveRemoteWalletBalance,
  type RemoteWalletData,
} from '@/lib/client/hooks/use-remote-wallets'
import { useAnimatedNumber } from '@/lib/client/hooks/use-animated-number'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'
import type { CardData } from '@/lib/client/hooks/use-cards'
import { InfoField } from './info-field'

interface Props {
  wallet: RemoteWalletData
  /** Caller's full LA list — used to count how many bind to this wallet. */
  addresses: WalletAddress[]
  /** Caller's full card list — used to count how many bind to this wallet. */
  cards: CardData[]
  onClose: () => void
}

/**
 * Remote Wallet detail dialog. Redesigned to lead with the balance —
 * the wallet's reason for existing — rather than buryin it in a grid
 * of metadata fields. Mirrors the visual hierarchy of a real wallet:
 *
 *   [balance hero, big tabular number]
 *   [wallet name + Default badge]
 *   [Receive] [Send]    ← actions
 *   ─────────────────
 *   compact metadata
 *
 * The Send / Receive buttons jump to the existing `/wallet/send` and
 * `/wallet/receive` flows — those operate on the user's default
 * wallet today; threading a `walletId` query param to scope them to
 * an arbitrary wallet is out of scope here. The "Manage wallet"
 * footer link still goes to the list page.
 *
 * The balance line is inline (not WalletLiveBalance) because the
 * layout is wallet-specific: huge numerals, small status row
 * beneath, gradient surface around it — none of which fits the
 * shared component's two-size knob.
 */
export function WalletDetailDialog({ wallet, addresses, cards, onClose }: Props) {
  const isLive = wallet.status !== 'REVOKED'
  const balance = useLiveRemoteWalletBalance(isLive ? wallet.id : null)
  const animatedSats = useAnimatedNumber(balance.data?.balanceSats ?? null)

  // Match the LA edge logic in buildGraph.
  const boundLas = addresses.filter(a => {
    if (a.mode === 'CUSTOM_NWC') return a.remoteWalletId === wallet.id
    if (a.mode === 'DEFAULT_NWC') return wallet.isDefault
    return false
  })
  const boundCards = cards.filter(c => c.remoteWalletId === wallet.id)

  const hasBalance = isLive && balance.data != null
  const state: 'searching' | 'connected' | 'error' | 'disabled' = !isLive
    ? 'disabled'
    : balance.error
      ? 'error'
      : hasBalance
        ? 'connected'
        : 'searching'
  const stateLabel = {
    connected: 'Connected',
    searching: 'Searching…',
    error: 'Unavailable',
    disabled: 'Disabled',
  }[state]

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-amber-400" />
            Remote Wallet
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* HERO — balance card. Gradient surface + a soft amber glow
              in the corner gives it some weight without screaming. */}
          <div className="relative overflow-hidden rounded-lg border border-border bg-gradient-to-br from-card to-card/40 p-5">
            {/* Decorative glow — pointer-events-none so it doesn't
                interfere with the action buttons below. */}
            <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-amber-400/10 blur-3xl" />

            {/* Balance row */}
            <div className="relative space-y-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Balance
              </div>
              <div
                className="flex items-baseline gap-2 tabular-nums"
                aria-label={`Balance ${state}`}
              >
                <span className="text-4xl font-semibold leading-none">
                  {hasBalance ? animatedSats.toLocaleString() : '—'}
                </span>
                <span className="text-base text-muted-foreground">sats</span>
              </div>
              {/* Connection status — small row, dot + label. */}
              <div className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                <span
                  className={cn(
                    'inline-block size-1.5 shrink-0 rounded-full',
                    state === 'connected' && 'bg-emerald-400',
                    state === 'searching' && 'animate-pulse bg-amber-400',
                    state === 'error' && 'bg-destructive',
                    state === 'disabled' && 'bg-muted-foreground',
                  )}
                />
                {stateLabel}
              </div>
            </div>

            {/* Wallet name + Default badge — secondary line. Sits
                comfortably below the balance, with the wallet icon
                doubling as a "this is a wallet" affordance. */}
            <div className="relative mt-5 flex items-center gap-2 text-sm font-medium">
              <Wallet className="size-4 shrink-0 text-amber-400" />
              <span className="truncate">{wallet.name}</span>
              {wallet.isDefault && (
                <Badge variant="secondary" className="gap-1">
                  <Star className="size-3 fill-amber-400 text-amber-400" />
                  Default
                </Badge>
              )}
            </div>

            {/* Action row — Receive (secondary) + Send (theme). Matches
                the home-screen pattern. Both close the dialog before
                navigating so the canvas isn't masked when the user
                returns. */}
            <div className="relative mt-4 flex gap-2">
              <Button
                variant="secondary"
                className="h-11 flex-1"
                disabled={!isLive}
                asChild={isLive}
                onClick={onClose}
              >
                {isLive ? (
                  <Link href="/wallet/receive">
                    <ArrowDownLeft className="size-4" />
                    Receive
                  </Link>
                ) : (
                  <span>
                    <ArrowDownLeft className="size-4" />
                    Receive
                  </span>
                )}
              </Button>
              <Button
                variant="theme"
                className="h-11 flex-1"
                disabled={!isLive}
                asChild={isLive}
                onClick={onClose}
              >
                {isLive ? (
                  <Link href="/wallet/send">
                    <ArrowUpRight className="size-4" />
                    Send
                  </Link>
                ) : (
                  <span>
                    <ArrowUpRight className="size-4" />
                    Send
                  </span>
                )}
              </Button>
            </div>
          </div>

          {/* Compact metadata strip — the bookkeeping fields, smaller
              than the hero but still legible. Two columns to keep the
              dialog tall but not narrow. */}
          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Type" value={<Badge variant="outline">{wallet.type}</Badge>} />
            <InfoField
              label="Status"
              value={<Badge variant="outline">{wallet.status}</Badge>}
            />

            <InfoField
              label="Bound addresses"
              value={
                boundLas.length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  <span>{boundLas.length}</span>
                )
              }
            />
            <InfoField
              label="Bound cards"
              value={
                boundCards.length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  <span>{boundCards.length}</span>
                )
              }
            />

            <InfoField
              label="Created"
              value={formatRelativeTime(wallet.createdAt)}
            />
            <InfoField
              label="Updated"
              value={formatRelativeTime(wallet.updatedAt)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" asChild onClick={onClose}>
            <Link href="/admin/remote-wallets">
              Manage wallet
              <ExternalLink className="ml-1 size-3" />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
