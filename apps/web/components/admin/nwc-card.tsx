'use client'

import React, { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Calendar,
  ChevronDown,
  Key,
  Loader2,
  Radio,
  Tag,
  Wallet,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useApi } from '@/lib/client/hooks/use-api'
import { useAuth } from '@/components/admin/auth-context'
import { parseNwc, truncatePubkey } from '@/lib/client/nwc'
import { useNwcBalance } from '@/lib/client/use-nwc-balance'
import { formatRelativeTime } from '@/lib/client/format'
import { AddressRoutingShortcuts } from '@/components/admin/address-routing-shortcuts'
import { cn } from '@/lib/utils'

interface UserMe {
  userId: string
  lightningAddress: string | null
  primaryUsername: string | null
  /** Connection string of the user's default RemoteWallet (or ''). */
  nwcString: string
  nwcUpdatedAt: string | null
}

interface NwcCardProps {
  username?: string | null
}

/**
 * Dashboard wallet card. Read-only view of the user's **default
 * RemoteWallet** balance — wallets are created and managed on the Remote
 * Wallets page (/admin/remote-wallets), which is the single source of
 * truth. The connection string is the owner's own default wallet, returned
 * by /api/users/me, so the balance is still read client-side via NWC.
 */
export function NwcCard({ username }: NwcCardProps = {}) {
  const { status } = useAuth()
  const { data: me } = useApi<UserMe>(
    status === 'authenticated' ? '/api/users/me' : null
  )

  const [expanded, setExpanded] = useState(false)
  // Spinner + dimmed state while the wallet-view navigation loads; cleared
  // naturally when this page unmounts.
  const [navigating, setNavigating] = useState(false)
  const nwcString = me?.nwcString ?? ''

  const parsedNwc = useMemo(
    () => (nwcString ? parseNwc(nwcString) : null),
    [nwcString]
  )

  // Real-time balance via NWC — polls every 30s plus subscribes to
  // NIP-47 payment notifications for instant updates.
  const balance = useNwcBalance(nwcString || null, {
    onTransaction: tx => {
      const isIncoming = tx.type === 'incoming'
      const amount = `${tx.amountSats.toLocaleString()} sats`
      const description = tx.description || (isIncoming ? 'Lightning payment received' : 'Lightning payment sent')
      toast(isIncoming ? `Received ${amount}` : `Sent ${amount}`, {
        description,
        icon: React.createElement(isIncoming ? ArrowDownLeft : ArrowUpRight, {
          className: `size-4 ${isIncoming ? 'text-green-500' : 'text-yellow-500'}`,
        }),
      })
    },
  })

  // Don't show the card unless the user has a lightning address
  if (!me || !me.lightningAddress) return null

  const hasWallet = Boolean(nwcString)
  const primaryUsername = username ?? me.primaryUsername

  // No primary wallet — point the user at the Remote Wallets page to add one.
  if (!hasWallet) {
    return <AddressRoutingShortcuts username={primaryUsername} />
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#897FFF]/10">
              <Image src="/logos/nwc.svg" alt="NWC" width={28} height={28} className="size-7" />
              {/* Balance couldn't be read → a warning badge on the icon
                  replaces the old "Unavailable" text. */}
              {balance.error && (
                <span
                  title="Balance unavailable"
                  className="absolute -left-1.5 -top-1.5 flex items-center justify-center rounded-full bg-card p-0.5"
                >
                  <AlertTriangle
                    className="size-4 text-destructive"
                    aria-label="Balance unavailable"
                  />
                </span>
              )}
            </div>
            <div className="flex flex-col">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Balance
              </span>
              <span className="text-xs text-muted-foreground">Primary wallet</span>
            </div>
          </div>
          {parsedNwc && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-label={expanded ? 'Hide connection details' : 'Show connection details'}
              aria-expanded={expanded}
              title={expanded ? 'Hide connection details' : 'Show connection details'}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>

        {/* Balance value */}
        <div className="mt-4 flex min-h-9 items-baseline gap-1.5">
          {balance.sats !== null ? (
            <>
              <span className="text-4xl font-semibold tabular-nums leading-none">
                {balance.sats.toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground">sats</span>
            </>
          ) : balance.error ? (
            // Error is surfaced by the warning badge on the NWC icon above.
            <span className="text-sm text-muted-foreground">—</span>
          ) : (
            <Spinner size={24} className="text-muted-foreground" />
          )}
        </div>

        {/* Jump to the full end-user wallet experience (send / receive / activity). */}
        <Button
          asChild
          variant="theme"
          className={cn('mt-5 w-full', navigating && 'pointer-events-none opacity-70')}
        >
          <Link
            href="/wallet"
            onClick={() => setNavigating(true)}
            aria-disabled={navigating}
          >
            {navigating ? <Spinner size={16} /> : <Wallet className="size-4" />}
            Switch to Wallet View
            {!navigating && <ArrowRight className="size-4" />}
          </Link>
        </Button>
      </div>

      {parsedNwc && expanded && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/40 px-3 py-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              {balance.status === 'connected' ? (
                <>
                  <span className="relative flex size-2 shrink-0">
                    <span className="absolute inline-flex size-full rounded-full bg-green-500 opacity-75 animate-ping" />
                    <span className="relative inline-flex size-2 rounded-full bg-green-500" />
                  </span>
                  <span className="text-foreground font-medium">Connected</span>
                </>
              ) : balance.status === 'disconnected' ? (
                <>
                  <WifiOff className="size-3.5 text-destructive shrink-0" />
                  <span className="text-destructive font-medium">Disconnected</span>
                </>
              ) : (
                <>
                  <Loader2 className="size-3.5 text-muted-foreground shrink-0 animate-spin" />
                  <span className="text-muted-foreground font-medium">Connecting…</span>
                </>
              )}
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/remote-wallets">Manage wallets</Link>
            </Button>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs pl-5">
            {parsedNwc.name && (
              <>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Tag className="size-3" />
                  Name
                </div>
                <span className="text-foreground truncate">{parsedNwc.name}</span>
              </>
            )}
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Key className="size-3" />
              Pubkey
            </div>
            <span className="text-foreground font-mono truncate" title={parsedNwc.pubkey}>
              {truncatePubkey(parsedNwc.pubkey)}
            </span>
            <div className="flex items-start gap-1.5 text-muted-foreground">
              <Radio className="size-3 mt-0.5" />
              Relay{parsedNwc.relays.length > 1 ? 's' : ''}
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              {parsedNwc.relays.length === 0 ? (
                <span className="text-muted-foreground">None</span>
              ) : (
                parsedNwc.relays.map((relay, i) => (
                  <span key={i} className="text-foreground font-mono truncate" title={relay}>
                    {relay}
                  </span>
                ))
              )}
            </div>
            {me.nwcUpdatedAt && (
              <>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="size-3" />
                  Updated
                </div>
                <span className="text-foreground" title={new Date(me.nwcUpdatedAt).toLocaleString()}>
                  {formatRelativeTime(me.nwcUpdatedAt)}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
