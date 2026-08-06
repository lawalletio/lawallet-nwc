'use client'

import React from 'react'
import { ChevronLeft, Wallet } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { RemoteWalletForwardingPanel } from '@/components/wallet/remote-wallet-forwarding-panel'
import { RemoteWalletReceiveProtocols } from '@/components/wallet/remote-wallet-receive-protocols'
import { RemoteWalletNotificationsPanel } from '@/components/wallet/remote-wallet-notifications-panel'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import { useNwcTransactions } from '@/lib/client/hooks/use-nwc-transactions'
import {
  useRemoteWallet,
  useRemoteWalletConnectionString
} from '@/lib/client/hooks/use-remote-wallets'

export default function WalletRemoteWalletDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const wallet = useRemoteWallet(params?.id ?? null)
  const isActive = wallet.data?.status === 'ACTIVE'
  const connection = useRemoteWalletConnectionString(
    isActive ? (wallet.data?.id ?? null) : null
  )
  const transactions = useNwcTransactions(
    connection.data?.connectionString ?? null,
    100
  )

  return (
    <div className="flex flex-1 flex-col pb-32">
      <header className="sticky top-0 z-20 grid h-14 grid-cols-3 items-center bg-background/80 px-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => router.push('/wallet/settings/remote-wallets')}
          className="flex h-9 w-fit items-center gap-1.5 rounded-full bg-card px-3 text-sm font-medium transition-colors hover:bg-accent"
        >
          <ChevronLeft className="size-4" />
          Back
        </button>
        <h1 className="truncate text-center text-base font-semibold">
          Remote wallet
        </h1>
        <span aria-hidden />
      </header>
      <main className="flex flex-1 flex-col gap-5 px-4 pt-5">
        {wallet.loading && !wallet.data ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner />
          </div>
        ) : wallet.error || !wallet.data ? (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive">
            Wallet not found.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-1">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-card ring-1 ring-border/60">
                <Wallet className="size-5 text-amber-500" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-xl font-semibold">
                  {wallet.data.name}
                </h2>
                <div className="mt-1 flex gap-2">
                  <Badge variant="outline">{wallet.data.type}</Badge>
                  <Badge variant="secondary">{wallet.data.status}</Badge>
                </div>
              </div>
            </div>
            <RemoteWalletReceiveProtocols
              active={isActive}
              capabilities={wallet.data.receiveCapabilities}
            />
            <RemoteWalletForwardingPanel
              walletId={wallet.data.id}
              transactions={transactions.data ?? []}
              transactionsLoading={transactions.loading || connection.loading}
              transactionsError={transactions.error}
            />
            <RemoteWalletNotificationsPanel walletId={wallet.data.id} />
          </>
        )}
      </main>
      <NavTabbar />
    </div>
  )
}
