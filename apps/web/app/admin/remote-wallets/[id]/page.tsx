'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, ExternalLink, RefreshCw, Star, Wallet, Zap } from 'lucide-react'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import {
  useRemoteWallet,
  useLiveRemoteWalletBalance,
  useRemoteWalletConnectionString,
  type RemoteWalletData,
} from '@/lib/client/hooks/use-remote-wallets'
import { useNwcTransactions } from '@/lib/client/hooks/use-nwc-transactions'
import { useAnimatedNumber } from '@/lib/client/hooks/use-animated-number'
import { DEFAULT_LNCURL_SERVER } from '@/lib/lncurl'
import { RemoteWalletRowActions } from '@/components/admin/remote-wallet-row-actions'
import { WalletActions } from '@/components/admin/connection-map/wallet-detail-dialog'
import { LncurlCountdown } from '@/components/admin/remote-wallet/lncurl-countdown'
import { WalletBalanceChart } from '@/components/admin/remote-wallet/balance-chart'
import { WalletTransactionsList } from '@/components/admin/remote-wallet/transactions-list'

const STATUS_VARIANT: Record<
  RemoteWalletData['status'],
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  ACTIVE: 'default',
  DISABLED: 'secondary',
  REVOKED: 'outline',
  DEAD: 'destructive',
}

export default function RemoteWalletDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? null

  const { data: wallet, loading, error, refetch } = useRemoteWallet(id)

  // Only ACTIVE wallets have a live connection: skip the balance/transaction
  // round-trips (and the secret connection-string fetch) for the rest.
  const isActive = wallet?.status === 'ACTIVE'
  const balance = useLiveRemoteWalletBalance(isActive ? id : null)
  const connection = useRemoteWalletConnectionString(isActive ? id : null)
  const txs = useNwcTransactions(connection.data?.connectionString ?? null, 100)

  const balanceSats = balance.data?.balanceSats ?? null
  const animatedSats = useAnimatedNumber(balanceSats)
  const isLncurl = wallet?.provider === 'lncurl'
  // True while a WebLN-funded receive is in flight — drives the balance
  // "incoming" loading animation.
  const [receiving, setReceiving] = useState(false)

  return (
    <div className="flex flex-col">
      <AdminTopbar title={wallet?.name ?? 'Wallet'} subtitle="Remote wallet" />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        <Link
          href="/admin/remote-wallets"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Remote wallets
        </Link>

        {loading && !wallet ? (
          <div className="flex items-center justify-center py-24">
            <Spinner size={24} className="text-muted-foreground" />
          </div>
        ) : error || !wallet ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-6 text-center text-sm text-destructive">
            {error ? 'Couldn’t load this wallet.' : 'Wallet not found.'}
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-2">
                <h1 className="flex items-center gap-2 text-xl font-semibold">
                  <Wallet className="size-5 shrink-0 text-amber-400" />
                  <span className="break-all">{wallet.name}</span>
                  {wallet.isDefault && (
                    <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" aria-label="Primary" />
                  )}
                </h1>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{wallet.type}</Badge>
                  <Badge variant={STATUS_VARIANT[wallet.status]}>{wallet.status}</Badge>
                  {isLncurl && (
                    <a
                      href={wallet.lncurlServerUrl ?? DEFAULT_LNCURL_SERVER}
                      target="_blank"
                      rel="noreferrer"
                      title="Open the LNCurl server that created this wallet"
                    >
                      <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 transition-opacity hover:opacity-80 dark:text-emerald-400">
                        <Zap className="size-3" />
                        LNCurl
                        <ExternalLink className="size-3" />
                      </Badge>
                    </a>
                  )}
                  {wallet.isDefault && (
                    <Badge variant="secondary" className="gap-1">
                      <Star className="size-3 fill-amber-400 text-amber-400" />
                      Default
                    </Badge>
                  )}
                </div>
              </div>
              <RemoteWalletRowActions wallet={wallet} onChanged={refetch} />
            </div>

            {!isActive && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
                This wallet is {wallet.status.toLowerCase()} — its live balance and
                activity aren’t available.
              </div>
            )}

            {/* Balance + chart */}
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="flex flex-col gap-4">
                <BalanceHero
                  wallet={wallet}
                  animatedSats={animatedSats}
                  hasBalance={isActive && balance.data != null}
                  state={
                    !isActive
                      ? 'disabled'
                      : balance.error
                        ? 'error'
                        : balance.data != null
                          ? 'connected'
                          : 'searching'
                  }
                  onPaid={() => {
                    // Payment just landed — refresh balance + activity right
                    // away rather than waiting for the next poll.
                    balance.refetch()
                    txs.refetch()
                  }}
                  receiving={receiving}
                  onReceivingChange={setReceiving}
                />
                {isLncurl && isActive && (
                  <LncurlCountdown balanceSats={balanceSats} />
                )}
              </div>

              <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                <h2 className="text-sm font-semibold">Balance over time</h2>
                <WalletBalanceChart
                  transactions={txs.data ?? []}
                  currentBalanceSats={balanceSats}
                />
              </div>
            </div>

            {/* Transactions */}
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Transactions</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => txs.refetch()}
                  disabled={txs.loading || !isActive}
                  aria-label="Refresh transactions"
                >
                  <RefreshCw className={cn('size-4', txs.loading && 'animate-spin')} />
                </Button>
              </div>
              {isActive ? (
                <WalletTransactionsList
                  transactions={txs.data ?? []}
                  loading={txs.loading || connection.loading}
                  error={txs.error}
                />
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Activity is only available for active wallets.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Balance hero (mirrors the connection-map dialog's hero) ─────────────────

function BalanceHero({
  wallet,
  animatedSats,
  hasBalance,
  state,
  onPaid,
  receiving,
  onReceivingChange,
}: {
  wallet: RemoteWalletData
  animatedSats: number
  hasBalance: boolean
  state: 'connected' | 'searching' | 'error' | 'disabled'
  onPaid?: () => void
  receiving?: boolean
  onReceivingChange?: (receiving: boolean) => void
}) {
  const stateLabel = {
    connected: 'Connected',
    searching: 'Searching…',
    error: 'Unavailable',
    disabled: 'Disabled',
  }[state]

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-gradient-to-br from-card to-card/40 p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-amber-400/10 blur-3xl" />

      <div
        className="absolute right-3 top-3 z-10 flex items-center gap-1.5 text-xs text-muted-foreground"
        aria-label={`Balance ${state}`}
      >
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

      <div className="relative space-y-1 text-center">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Balance
        </div>
        <div className="flex items-baseline justify-center gap-2 tabular-nums">
          <span
            className={cn(
              'text-4xl font-semibold leading-none transition-colors',
              receiving && 'animate-pulse text-emerald-500',
            )}
          >
            {hasBalance ? animatedSats.toLocaleString() : '—'}
          </span>
          <span className="text-base text-muted-foreground">sats</span>
        </div>
        {receiving && (
          <div className="flex items-center justify-center gap-1.5 pt-1 text-xs font-medium text-emerald-500 animate-in fade-in-0 duration-200">
            <Spinner className="size-3" />
            Incoming payment…
          </div>
        )}
      </div>

      <div className="relative mt-6">
        <WalletActions
          walletId={wallet.id}
          walletName={wallet.name}
          disabled={wallet.status !== 'ACTIVE'}
          onPaid={onPaid}
          onReceivingChange={onReceivingChange}
        />
      </div>
    </div>
  )
}
