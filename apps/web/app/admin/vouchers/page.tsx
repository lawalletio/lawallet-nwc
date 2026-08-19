'use client'

import React from 'react'
import { ExternalLink, RefreshCw, Ticket } from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { VoucherCard } from '@/components/admin/vouchers/voucher-card'
import { VoucherSettingsDialog } from '@/components/admin/vouchers/voucher-settings-dialog'
import {
  useVoucherMutations,
  useVouchers,
  type Voucher
} from '@/lib/client/hooks/use-vouchers'
import { cn } from '@/lib/utils'

/**
 * Vouchers arrive from outside the wallet, so the useful question here isn't
 * "how do I use this page" but "how does a merchant get a coupon to me" —
 * which is the integrator guide.
 */
const VOUCHERS_DOCS_URL = 'https://docs.lawallet.io/docs/integrations/vouchers'

function DocsLink({ className }: { className?: string }) {
  return (
    <a
      href={VOUCHERS_DOCS_URL}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground',
        className
      )}
    >
      How vouchers work
      <ExternalLink className="size-3" />
    </a>
  )
}

/**
 * `/admin/vouchers` — the signed-in user's coupon stash.
 *
 * Lives under `/admin` but the data is per-user: `/api/wallet/vouchers` scopes
 * everything by the authenticated pubkey, so a plain USER sees — and only sees
 * — their own vouchers, the same arrangement as Addresses and Remote Wallets.
 *
 * Vouchers arrive from *outside*: an external coupon-manager service deposits
 * them against the user's npub. There is nothing to create here, which is why
 * the header carries deposit settings and a refresh instead of an "Add" CTA.
 */
export default function VouchersPage() {
  const { data: vouchers, loading, error, refetch } = useVouchers()
  const { refreshVoucher } = useVoucherMutations()
  const [busy, setBusy] = React.useState<Set<string>>(new Set())

  const setRefreshing = React.useCallback((id: string, on: boolean) => {
    setBusy(current => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const handleRefresh = React.useCallback(
    async (voucher: Voucher) => {
      setRefreshing(voucher.id, true)
      try {
        const { voucher: updated, checked } = await refreshVoucher(voucher.id)
        if (!checked) {
          toast.info('Already up to date')
        } else if (updated.status !== voucher.status) {
          toast.success(
            `${voucher.name} is now ${updated.status.toLowerCase()}`
          )
        } else {
          toast.success('Status confirmed')
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Could not reach the service'
        )
      } finally {
        setRefreshing(voucher.id, false)
      }
    },
    [refreshVoucher, setRefreshing]
  )

  const refreshable = React.useMemo(
    () => (vouchers ?? []).filter(v => v.status === 'MINTED'),
    [vouchers]
  )
  const [refreshingAll, setRefreshingAll] = React.useState(false)

  async function handleRefreshAll() {
    setRefreshingAll(true)
    try {
      // Sequential on purpose: each one is an outbound request to somebody
      // else's service, and the server-side rate limiter would reject a burst.
      for (const voucher of refreshable) {
        setRefreshing(voucher.id, true)
        try {
          await refreshVoucher(voucher.id)
        } catch {
          // One unreachable service shouldn't abort the rest.
        } finally {
          setRefreshing(voucher.id, false)
        }
      }
      toast.success('Statuses refreshed')
    } finally {
      setRefreshingAll(false)
    }
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar title="Vouchers" />

      <div className="flex flex-col gap-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Your vouchers</h2>
            <p className="text-sm text-muted-foreground">
              Coupons that merchants have issued to your Nostr identity. Show
              the code at the till to redeem.
            </p>
            <DocsLink className="mt-1" />
          </div>
          <div className="flex gap-2">
            {refreshable.length > 0 ? (
              <Button
                variant="outline"
                onClick={handleRefreshAll}
                disabled={refreshingAll}
              >
                <RefreshCw
                  data-icon="inline-start"
                  className={cn(refreshingAll && 'animate-spin')}
                />
                Refresh all
              </Button>
            ) : null}
            <VoucherSettingsDialog />
          </div>
        </div>

        {error ? (
          <ErrorState message={error.message} onRetry={refetch} />
        ) : loading && !vouchers ? (
          <VouchersSkeleton />
        ) : !vouchers || vouchers.length === 0 ? (
          <EmptyState />
        ) : (
          <section
            aria-label="Your vouchers"
            className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {vouchers.map(voucher => (
              <VoucherCard
                key={voucher.id}
                voucher={voucher}
                refreshing={busy.has(voucher.id)}
                onRefresh={() => handleRefresh(voucher)}
              />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

function VouchersSkeleton() {
  return (
    <section
      aria-label="Loading vouchers"
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
    >
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
        >
          <Skeleton className="aspect-video rounded-none" />
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      ))}
    </section>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-card ring-1 ring-border/50">
        <Ticket className="size-6 text-muted-foreground" />
      </span>
      <h3 className="text-base font-semibold">No vouchers yet</h3>
      <p className="max-w-md text-sm text-muted-foreground">
        Merchants issue coupons to your Nostr identity, and they show up here
        automatically. Nothing to set up — though you can restrict which
        services are allowed to send you one.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <VoucherSettingsDialog />
        <DocsLink />
      </div>
    </div>
  )
}

function ErrorState({
  message,
  onRetry
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl bg-card px-6 py-10 text-center">
      <p className="text-sm text-muted-foreground">
        Couldn’t load your vouchers: {message}
      </p>
      <Button variant="outline" onClick={onRetry}>
        <RefreshCw data-icon="inline-start" />
        Try again
      </Button>
    </div>
  )
}
