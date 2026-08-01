'use client'

import {
  AlertTriangle,
  Forward,
  Loader2,
  RefreshCw,
  ShieldCheck,
  WifiOff
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  useProxyPendingBalance,
  useProxyPendingBalanceMutation
} from '@/lib/client/hooks/use-wallet-addresses'
import { formatMsats, formatRelativeTime } from '@/lib/client/format'
import { cn } from '@/lib/utils'

interface ProxyPendingBalanceCardProps {
  username: string
  configuredDestination: string | null
}

/**
 * Operational liability for a deferred Lightning Address proxy. This is not
 * the proxy wallet's spendable balance: it is the exact net amount received
 * for confirmed payer invoices that has not yet been proven forwarded.
 */
export function ProxyPendingBalanceCard({
  username,
  configuredDestination
}: ProxyPendingBalanceCardProps) {
  const { data, loading, error, refetch } = useProxyPendingBalance(username)
  const { forwardPending, forwardingPending } =
    useProxyPendingBalanceMutation(username)

  const pendingCount = data?.pendingPaymentCount ?? 0
  const blockedCount = data?.blockedPaymentCount ?? 0
  const inFlightCount = data?.inFlightPaymentCount ?? 0
  const hasPending = pendingCount > 0
  const destination = data?.destination ?? configuredDestination
  const forwardingActive = inFlightCount > 0

  async function handleForwardPending() {
    try {
      const result = await forwardPending()
      await refetch()

      if (result.reconciliation.completed > 0) {
        const count = result.reconciliation.completed
        toast.success(
          `${count} pending ${count === 1 ? 'payment' : 'payments'} forwarded`
        )
      } else if (result.reconciliation.failed > 0) {
        toast.error('Forwarding still needs attention')
      } else {
        toast.success('Pending forwarding started')
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not forward pending funds'
      )
      await refetch()
    }
  }

  return (
    <section
      aria-label="Pending proxy balance"
      className={cn(
        'relative overflow-hidden rounded-xl border px-5 py-4',
        hasPending
          ? 'border-amber-500/25 bg-gradient-to-br from-amber-500/[0.12] via-amber-500/[0.04] to-transparent'
          : 'border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.08] via-transparent to-transparent'
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              'grid size-11 shrink-0 place-items-center rounded-xl ring-1 ring-inset',
              hasPending
                ? 'bg-amber-500/10 text-amber-500 ring-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-500 ring-emerald-500/20'
            )}
          >
            {hasPending ? (
              <Forward className="size-5" aria-hidden />
            ) : (
              <ShieldCheck className="size-5" aria-hidden />
            )}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Pending balance
              </p>
              {blockedCount > 0 && (
                <Badge
                  variant="destructive"
                  className="h-5 gap-1 px-1.5 text-[10px]"
                >
                  <AlertTriangle className="size-3" />
                  {blockedCount} blocked
                </Badge>
              )}
              {inFlightCount > 0 && (
                <Badge
                  variant="outline"
                  className="h-5 border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-500"
                >
                  {inFlightCount} resolving
                </Badge>
              )}
            </div>

            {error ? (
              <div className="mt-1 inline-flex items-center gap-1.5 text-sm text-destructive">
                <WifiOff className="size-3.5" />
                Pending balance unavailable
              </div>
            ) : !data && loading ? (
              <div className="mt-2">
                <Spinner size={24} className="text-muted-foreground" />
              </div>
            ) : (
              <>
                <p
                  className={cn(
                    'mt-1 text-2xl font-semibold leading-none tabular-nums',
                    hasPending ? 'text-amber-500' : 'text-emerald-500'
                  )}
                >
                  {formatMsats(data?.pendingAmountMsats ?? '0')}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {hasPending
                    ? `Net amount across ${pendingCount} ${pendingCount === 1 ? 'payment' : 'payments'}, after service fees.`
                    : 'All confirmed proxy payments have been forwarded.'}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3 sm:justify-end sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <div className="min-w-0 text-left sm:text-right">
            <p className="truncate font-mono text-xs text-foreground">
              {destination ?? 'No destination configured'}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {data?.oldestPendingAt && hasPending
                ? `Oldest pending ${formatRelativeTime(data.oldestPendingAt)}`
                : 'Configured destination'}
            </p>
          </div>
          {hasPending && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void handleForwardPending()}
              disabled={loading || forwardingPending || forwardingActive}
              aria-label={
                forwardingActive || forwardingPending
                  ? 'Pending funds are forwarding'
                  : 'Forward pending funds'
              }
              title={
                forwardingActive
                  ? 'An outgoing payment is already in progress or awaiting confirmation'
                  : 'Forward all pending proxy funds now'
              }
              className="shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-500 hover:bg-amber-500/15 hover:text-amber-400"
            >
              {forwardingActive || forwardingPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Forward />
              )}
              {forwardingActive
                ? 'Forwarding'
                : forwardingPending
                  ? 'Starting'
                  : 'Forward pending'}
            </Button>
          )}
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={loading}
            aria-label="Refresh pending balance"
            title="Refresh pending balance"
            className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </button>
        </div>
      </div>
    </section>
  )
}
