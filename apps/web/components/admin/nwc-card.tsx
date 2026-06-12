'use client'

import React, { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  ChevronDown,
  Forward,
  Key,
  Loader2,
  Radio,
  Tag,
  Wallet,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useApi } from '@/lib/client/hooks/use-api'
import { useAuth } from '@/components/admin/auth-context'
import { useAddressMutations } from '@/lib/client/hooks/use-wallet-addresses'
import { parseNwc, truncatePubkey } from '@/lib/client/nwc'
import { useNwcBalance } from '@/lib/client/use-nwc-balance'
import { formatRelativeTime } from '@/lib/client/format'
import { isLightningAddress } from '@/lib/ln-address'

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
  onUpdated?: () => void | Promise<void>
}

/**
 * Dashboard wallet card. Read-only view of the user's **default
 * RemoteWallet** balance — wallets are created and managed on the Remote
 * Wallets page (/admin/remote-wallets), which is the single source of
 * truth. The connection string is the owner's own default wallet, returned
 * by /api/users/me, so the balance is still read client-side via NWC.
 */
export function NwcCard({ username, onUpdated }: NwcCardProps = {}) {
  const { status } = useAuth()
  const { data: me } = useApi<UserMe>(
    status === 'authenticated' ? '/api/users/me' : null
  )

  const [expanded, setExpanded] = useState(false)
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
    return (
      <NoWalletRoutingOptions
        username={primaryUsername}
        onUpdated={onUpdated}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-yellow-500/20 bg-gradient-to-br from-yellow-500/15 via-yellow-500/5 to-transparent px-5 py-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#897FFF]/10">
            <Image src="/logos/nwc.svg" alt="NWC" width={28} height={28} className="size-7" />
          </div>
          <div className="flex flex-col">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Balance
            </span>
            <span className="text-xs text-muted-foreground">Primary wallet</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {balance.sats !== null ? (
            <span className="text-3xl font-semibold tabular-nums leading-none">
              {balance.sats.toLocaleString()}
              <span className="ml-1.5 text-sm text-muted-foreground font-normal">sats</span>
            </span>
          ) : balance.error ? (
            <span className="text-sm text-destructive">Unavailable</span>
          ) : (
            <Spinner size={24} className="text-muted-foreground" />
          )}
          {parsedNwc && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-label={expanded ? 'Hide connection details' : 'Show connection details'}
              aria-expanded={expanded}
              title={expanded ? 'Hide connection details' : 'Show connection details'}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            >
              <ChevronDown className={`size-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
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

function NoWalletRoutingOptions({
  username,
  onUpdated,
}: {
  username: string | null | undefined
  onUpdated?: () => void | Promise<void>
}) {
  const { updateAddress } = useAddressMutations()
  const [redirect, setRedirect] = useState('')
  const [saving, setSaving] = useState(false)

  const trimmed = redirect.trim().toLowerCase()
  const redirectInvalid = trimmed.length > 0 && !isLightningAddress(trimmed)
  const canForward = Boolean(username) && trimmed.length > 0 && !redirectInvalid && !saving

  async function handleForward() {
    if (!username || !canForward) return

    setSaving(true)
    try {
      await updateAddress(username, {
        mode: 'ALIAS',
        redirect: trimmed,
        remoteWalletId: null,
      })
      toast.success('Forwarding enabled')
      setRedirect('')
      await onUpdated?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to set forwarding')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <Link
        href="/admin/remote-wallets"
        className="flex items-center gap-3 rounded-xl border border-dashed border-border px-5 py-5 transition-colors hover:bg-muted/40"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#897FFF]/10">
          <Wallet className="size-5 text-muted-foreground" />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium">Connect a wallet</span>
          <span className="text-xs text-muted-foreground">
            Add a wallet to receive payments at your lightning address.
          </span>
        </div>
      </Link>

      <div className="rounded-xl border border-border bg-card px-5 py-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <Forward className="size-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Redirect to existing address</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Forward payments to another Lightning Address.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="dashboard-forwarding-target">
                Existing Lightning Address
              </label>
              <Input
                id="dashboard-forwarding-target"
                placeholder="someone@example.com"
                value={redirect}
                disabled={!username || saving}
                onChange={e => setRedirect(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && canForward) handleForward()
                }}
                className={redirectInvalid ? 'border-destructive' : undefined}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <Button
                variant="theme"
                disabled={!canForward}
                onClick={handleForward}
                className="shrink-0"
              >
                {saving ? (
                  <Spinner size={16} className="mr-2" />
                ) : (
                  <ArrowRight className="mr-2 size-4" />
                )}
                Forward
              </Button>
            </div>

            {redirectInvalid ? (
              <p className="text-xs text-destructive">
                Enter a valid lightning address (user@host).
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                This switches @{username ?? 'your address'} to redirect mode.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
