'use client'

import React, { useMemo, useState } from 'react'
import Image from 'next/image'
import { Check, RefreshCw, X, Radio, Key, Tag, Calendar, ArrowDownLeft, ArrowUpRight, WifiOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { InputWithQrScanner } from '@/components/ui/input-with-qr-scanner'
import { Spinner } from '@/components/ui/spinner'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'
import { useAuth } from '@/components/admin/auth-context'
import { parseNwc, truncatePubkey } from '@/lib/client/nwc'
import { useNwcBalance, nwcStatusLabel } from '@/lib/client/use-nwc-balance'
import { formatRelativeTime } from '@/lib/client/format'


interface UserMe {
  userId: string
  lightningAddress: string | null
  nwcString: string
  nwcUpdatedAt: string | null
}

export function NwcCard() {
  const { status } = useAuth()
  const { data: me, refetch } = useApi<UserMe>(
    status === 'authenticated' ? '/api/users/me' : null
  )
  const { mutate, loading } = useMutation<{ nwcUri: string }, { nwc: string }>()

  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  // Parse the NWC URI once per value change instead of on every render.
  // NOTE: hooks must be called unconditionally on every render — keep these
  // above any early return.
  const parsedNwc = useMemo(
    () => (me?.nwcString ? parseNwc(me.nwcString) : null),
    [me?.nwcString]
  )

  // Real-time balance via NWC — polls every 30s plus subscribes to
  // NIP-47 payment notifications for instant updates.
  const balance = useNwcBalance(me?.nwcString && !editing ? me.nwcString : null, {
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

  const hasNwc = Boolean(me.nwcString)
  const showForm = !hasNwc || editing

  async function handleSave() {
    if (!me) return
    const trimmed = value.trim()
    if (!trimmed) {
      toast.error('NWC connection string is required')
      return
    }
    if (!trimmed.startsWith('nostr+walletconnect://')) {
      toast.error('NWC string must start with nostr+walletconnect://')
      return
    }
    try {
      await mutate('put', `/api/users/${me.userId}/nwc`, { nwcUri: trimmed })
      toast.success('NWC connection saved')
      setEditing(false)
      setValue('')
      refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save NWC')
    }
  }

  function handleCancel() {
    setEditing(false)
    setValue('')
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      {/* Header: shown whenever the input form is visible (empty state OR editing). */}
      {showForm && (
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#897FFF]/10">
            <Image
              src="/logos/nwc.svg"
              alt="NWC"
              width={24}
              height={24}
              className="size-6"
            />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">
              {editing ? 'Replace wallet connection' : 'Wallet Connection (NWC)'}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {editing
                ? 'Paste a new NWC connection string to replace your current wallet.'
                : 'Connect a Nostr Wallet Connect (NWC) wallet to receive payments at your lightning address.'}
            </p>
          </div>
          {editing && hasNwc && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={loading}
              aria-label="Cancel"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      )}

      {hasNwc && !editing && !parsedNwc && (
        <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2">
          {balance.status === 'connected' ? (
            <Check className="size-3.5 text-green-500 shrink-0" />
          ) : balance.status === 'disconnected' ? (
            <WifiOff className="size-3.5 text-destructive shrink-0" />
          ) : (
            <Loader2 className="size-3.5 text-muted-foreground shrink-0 animate-spin" />
          )}
          <span className="text-xs text-muted-foreground truncate">
            {nwcStatusLabel(balance.status)}
            {me.nwcUpdatedAt ? ` · added ${formatRelativeTime(me.nwcUpdatedAt)}` : ''}
          </span>
        </div>
      )}

      {hasNwc && !editing && (
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
                Nostr Wallet Connect
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
              <span className="text-sm text-destructive">Unavailable</span>
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
              <RefreshCw
                className={`size-4 ${balance.loading ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>
      )}

      {hasNwc && !editing && parsedNwc && (
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(true)
                setValue('')
              }}
            >
              <RefreshCw className="size-3.5 mr-1" />
              Replace
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
                  <span
                    key={i}
                    className="text-foreground font-mono truncate"
                    title={relay}
                  >
                    {relay}
                  </span>
                ))
              )}
            </div>
            {me.nwcUpdatedAt && (
              <>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Calendar className="size-3" />
                  Added
                </div>
                <span
                  className="text-foreground"
                  title={new Date(me.nwcUpdatedAt).toLocaleString()}
                >
                  {formatRelativeTime(me.nwcUpdatedAt)}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="space-y-2">
          <InputWithQrScanner
            // Keep `type="password"` so the connection string (which carries
            // a secret) is masked on screen. Browsers also skip autofill
            // suggestions on password inputs, which is what we want here.
            type="password"
            placeholder="nostr+walletconnect://..."
            value={value}
            onChange={setValue}
            onScan={text => setValue(text.trim())}
            onScanError={err => toast.error(err)}
            scanLabel="Scan NWC QR code"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground">
            Get a connection string from{' '}
            <a
              href="https://nwc.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Alby
            </a>
            , Mutiny, Primal, or any NWC-compatible wallet.
          </p>
          <div className="pt-2">
            <Button
              variant="theme"
              onClick={handleSave}
              disabled={!value.trim() || loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Spinner size={16} className="mr-2" />
                  Saving...
                </>
              ) : (
                'Save connection'
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
