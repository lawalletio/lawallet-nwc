'use client'

import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft,
  RefreshCw,
  Star,
  Wallet
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { CreateRemoteWalletDialog } from '@/components/admin/create-remote-wallet-dialog'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import {
  useRemoteWalletMutations,
  useRemoteWallets,
  type RemoteWalletData
} from '@/lib/client/hooks/use-remote-wallets'
import { cn } from '@/lib/utils'

type PendingAction = 'primary' | 'status'

export function RemoteWalletsScreen() {
  const router = useRouter()
  const { data: wallets, loading, error, refetch } = useRemoteWallets()
  const { setPrimary, setStatus } = useRemoteWalletMutations()
  const [pending, setPending] = useState<{
    id: string
    action: PendingAction
  } | null>(null)

  const sortedWallets = useMemo(
    () =>
      [...(wallets ?? [])].sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
        if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1
        return a.name.localeCompare(b.name)
      }),
    [wallets]
  )

  async function runAction(
    wallet: RemoteWalletData,
    action: PendingAction,
    work: () => Promise<unknown>,
    success: string
  ) {
    setPending({ id: wallet.id, action })
    try {
      await work()
      toast.success(success)
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update wallet')
    } finally {
      setPending(null)
    }
  }

  function handleSetPrimary(wallet: RemoteWalletData) {
    void runAction(
      wallet,
      'primary',
      () => setPrimary(wallet.id),
      `${wallet.name} is now primary`
    )
  }

  function handleToggleStatus(wallet: RemoteWalletData, checked: boolean) {
    void runAction(
      wallet,
      'status',
      () => setStatus(wallet.id, checked ? 'ACTIVE' : 'DISABLED'),
      checked ? `${wallet.name} enabled` : `${wallet.name} disabled`
    )
  }

  return (
    <div className="flex flex-1 flex-col pb-32">
      <header className="sticky top-0 z-20 grid h-14 grid-cols-3 items-center bg-background/80 px-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-9 w-fit items-center gap-1.5 rounded-full bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          <ChevronLeft className="size-4" />
          Back
        </button>
        <h1 className="text-center text-base font-semibold text-foreground">
          Remote wallets
        </h1>
        <span aria-hidden />
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pt-4">
        {loading && !wallets ? (
          <WalletSkeleton />
        ) : error ? (
          <ErrorState onRetry={refetch} />
        ) : sortedWallets.length === 0 ? (
          <EmptyState onCreated={refetch} />
        ) : (
          <>
            <div className="flex justify-end">
              <CreateRemoteWalletDialog onCreated={refetch} />
            </div>
            <section
              className="flex flex-col gap-3"
              aria-label="Remote wallets"
            >
              {sortedWallets.map(wallet => (
                <WalletRow
                  key={wallet.id}
                  wallet={wallet}
                  pending={pending}
                  onSetPrimary={() => handleSetPrimary(wallet)}
                  onToggleStatus={checked => handleToggleStatus(wallet, checked)}
                />
              ))}
            </section>
          </>
        )}
      </main>

      <NavTabbar />
    </div>
  )
}

function WalletRow({
  wallet,
  pending,
  onSetPrimary,
  onToggleStatus
}: {
  wallet: RemoteWalletData
  pending: { id: string; action: PendingAction } | null
  onSetPrimary: () => void
  onToggleStatus: (checked: boolean) => void
}) {
  const rowPending = pending?.id === wallet.id
  const active = wallet.status === 'ACTIVE'
  const primary = wallet.isDefault
  const canSetPrimary = !wallet.isDefault && active
  const statusToggleDisabled = rowPending

  if (!primary) {
    return (
      <article
        className={cn(
          'flex items-center gap-3 rounded-xl bg-card p-3 ring-1 ring-border/40 transition-opacity duration-200',
          !active && 'opacity-70'
        )}
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
          <Wallet className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-foreground">
            {wallet.name}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {wallet.type} · Updated {formatDate(wallet.updatedAt)}
          </p>
          {wallet.provider && (
            <div className="mt-1 flex">
              <Badge variant="secondary">LNCurl</Badge>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canSetPrimary && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={rowPending}
              onClick={onSetPrimary}
            >
              {pending?.id === wallet.id && pending.action === 'primary' ? (
                <Spinner data-icon="inline-start" size={16} />
              ) : (
                <Star data-icon="inline-start" />
              )}
              Set primary
            </Button>
          )}
          <Switch
            checked={active}
            disabled={rowPending}
            aria-label={`${active ? 'Disable' : 'Enable'} ${wallet.name}`}
            onCheckedChange={onToggleStatus}
          />
        </div>
      </article>
    )
  }

  return (
    <article
      className={cn(
        'flex flex-col bg-card transition-[opacity,box-shadow,transform] duration-200',
        'gap-4 rounded-2xl p-4 shadow-[0_20px_70px_-42px_hsl(var(--primary))] ring-1 ring-primary/50',
        !active && 'opacity-70'
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-background text-muted-foreground">
          <Wallet className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-foreground">
                {wallet.name}
              </h2>
              <p className="text-xs text-muted-foreground">
                {wallet.type} · Updated {formatDate(wallet.updatedAt)}
              </p>
            </div>
            <Switch
              checked={active}
              disabled={statusToggleDisabled}
              aria-label={`${active ? 'Disable' : 'Enable'} ${wallet.name}`}
              onCheckedChange={onToggleStatus}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {wallet.isDefault && <Badge>Primary</Badge>}
            {wallet.provider && <Badge variant="secondary">LNCurl</Badge>}
          </div>
        </div>
      </div>
    </article>
  )
}

function WalletSkeleton() {
  return (
    <section className="flex flex-col gap-3" aria-label="Loading wallets">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex flex-col gap-4 rounded-2xl bg-card p-4">
          <div className="flex gap-3">
            <Skeleton className="size-11 rounded-xl" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-44" />
            </div>
          </div>
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>
      ))}
    </section>
  )
}

function EmptyState({ onCreated }: { onCreated: () => Promise<void> }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-card ring-1 ring-border/50">
        <Wallet className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          No remote wallets
        </h2>
        <p className="max-w-64 text-sm leading-relaxed text-muted-foreground">
          Connect a wallet to send and receive from this device.
        </p>
      </div>
      <CreateRemoteWalletDialog onCreated={onCreated} />
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => Promise<void> }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-card px-6 py-10 text-center">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          Wallets unavailable
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Try again in a moment.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={() => void onRetry()}>
        <RefreshCw data-icon="inline-start" />
        Retry
      </Button>
    </div>
  )
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short'
  })
}
