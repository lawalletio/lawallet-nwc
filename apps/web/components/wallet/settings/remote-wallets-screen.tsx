'use client'

import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, RefreshCw, Star, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { CreateRemoteWalletDialog } from '@/components/admin/create-remote-wallet-dialog'
import { CreateProxyWalletDialog } from '@/components/wallet/create-proxy-wallet-dialog'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import {
  useRemoteWalletMutations,
  useRemoteWallets,
  type RemoteWalletData
} from '@/lib/client/hooks/use-remote-wallets'
import { useLocale, useT } from '@/lib/client/i18n'
import { cn } from '@/lib/utils'

type PendingAction = 'primary' | 'status'

export function RemoteWalletsScreen() {
  const router = useRouter()
  const { data: wallets, loading, error, refetch } = useRemoteWallets()
  const { setPrimary, setStatus } = useRemoteWalletMutations()
  const t = useT()
  const l = t.remoteWallets.list
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
      toast.error(err instanceof Error ? err.message : l.updateFailed)
    } finally {
      setPending(null)
    }
  }

  function handleSetPrimary(wallet: RemoteWalletData) {
    void runAction(
      wallet,
      'primary',
      () => setPrimary(wallet.id),
      l.nowPrimary(wallet.name)
    )
  }

  function handleToggleStatus(wallet: RemoteWalletData, checked: boolean) {
    void runAction(
      wallet,
      'status',
      () => setStatus(wallet.id, checked ? 'ACTIVE' : 'DISABLED'),
      checked ? l.enabledToast(wallet.name) : l.disabledToast(wallet.name)
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
          {t.common.back}
        </button>
        <h1 className="text-center text-base font-semibold text-foreground">
          {t.settings.remoteWallets}
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
            <div className="flex flex-wrap justify-end gap-2">
              <CreateProxyWalletDialog
                wallets={sortedWallets}
                onChanged={refetch}
              />
              <CreateRemoteWalletDialog onCreated={refetch} />
            </div>
            <section
              className="flex flex-col gap-3"
              aria-label={t.settings.remoteWallets}
            >
              {sortedWallets.map(wallet => (
                <WalletRow
                  key={wallet.id}
                  wallet={wallet}
                  pending={pending}
                  onSetPrimary={() => handleSetPrimary(wallet)}
                  onToggleStatus={checked =>
                    handleToggleStatus(wallet, checked)
                  }
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
  const l = useT().remoteWallets.list
  const locale = useLocale()
  const updated = l.updated(
    wallet.type,
    new Date(wallet.updatedAt).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'short'
    })
  )
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
        <Link
          href={`/wallet/settings/remote-wallets/${wallet.id}`}
          className="min-w-0 flex-1 rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h2 className="truncate text-base font-semibold text-foreground">
            {wallet.name}
          </h2>
          <p className="truncate text-xs text-muted-foreground">{updated}</p>
          {wallet.provider && (
            <div className="mt-1 flex">
              <Badge variant="secondary">LNCurl</Badge>
            </div>
          )}
        </Link>
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
              {l.setPrimary}
            </Button>
          )}
          <Switch
            checked={active}
            disabled={rowPending}
            aria-label={active ? l.disable(wallet.name) : l.enable(wallet.name)}
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
            <Link
              href={`/wallet/settings/remote-wallets/${wallet.id}`}
              className="min-w-0 rounded-lg focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <h2 className="truncate text-base font-semibold text-foreground">
                {wallet.name}
              </h2>
              <p className="text-xs text-muted-foreground">{updated}</p>
            </Link>
            <Switch
              checked={active}
              disabled={statusToggleDisabled}
              aria-label={
                active ? l.disable(wallet.name) : l.enable(wallet.name)
              }
              onCheckedChange={onToggleStatus}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {wallet.isDefault && <Badge>{l.primary}</Badge>}
            {wallet.provider && <Badge variant="secondary">LNCurl</Badge>}
          </div>
        </div>
      </div>
    </article>
  )
}

function WalletSkeleton() {
  const l = useT().remoteWallets.list
  return (
    <section className="flex flex-col gap-3" aria-label={l.loading}>
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col gap-4 rounded-2xl bg-card p-4"
        >
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
  const l = useT().remoteWallets.list
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-card ring-1 ring-border/50">
        <Wallet className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          {l.emptyTitle}
        </h2>
        <p className="max-w-64 text-sm leading-relaxed text-muted-foreground">
          {l.emptyBody}
        </p>
      </div>
      <CreateRemoteWalletDialog onCreated={onCreated} />
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => Promise<void> }) {
  const t = useT()
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl bg-card px-6 py-10 text-center">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">
          {t.remoteWallets.list.errorTitle}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t.remoteWallets.list.tryAgain}
        </p>
      </div>
      <Button type="button" variant="outline" onClick={() => void onRetry()}>
        <RefreshCw data-icon="inline-start" />
        {t.common.retry}
      </Button>
    </div>
  )
}
