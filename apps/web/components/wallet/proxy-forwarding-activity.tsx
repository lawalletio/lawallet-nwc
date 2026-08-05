'use client'

import {
  Activity as ActivityIcon,
  AlertTriangle,
  ArrowDownLeft,
  Clock3,
  RotateCcw,
  Route,
  WifiOff
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { Spinner } from '@/components/ui/spinner'
import { ForwardingStatusBadge } from '@/components/wallet/shared/forwarding-status'
import {
  useAddressInvoices,
  type AddressInvoice,
  type AddressProxyAttempt,
  type AddressProxyPayment
} from '@/lib/client/hooks/use-wallet-addresses'
import {
  formatDateTime,
  formatMsats,
  formatRelativeTime
} from '@/lib/client/format'
import { cn } from '@/lib/utils'

interface ProxyForwardingActivityProps {
  username: string
}

type ProxyInvoice = AddressInvoice & { proxy: AddressProxyPayment }

/**
 * Operational timeline for one deferred-proxy address. Every destination
 * attempt is kept visible, including rejected and ambiguous attempts, so the
 * owner can correlate a retry with the listener request journal.
 */
export function ProxyForwardingActivity({
  username
}: ProxyForwardingActivityProps) {
  const { data, loading, error } = useAddressInvoices(username)
  const invoices = data?.invoices ?? []
  const proxyInvoices = invoices.filter(
    (invoice): invoice is ProxyInvoice => invoice.proxy !== null
  )
  let attemptCount = 0
  let retryCount = 0
  let attentionCount = 0
  for (const invoice of proxyInvoices) {
    attemptCount += invoice.proxy.attemptCount
    retryCount += invoice.proxy.retryCount
    if (invoice.proxy.status === 'BLOCKED' || invoice.proxy.lastError) {
      attentionCount += 1
    }
  }

  return (
    <Card className="overflow-hidden bg-card shadow-none">
      <CardHeader className="border-b border-border/60 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground ring-1 ring-inset ring-border">
            <ActivityIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <CardTitle
              role="heading"
              aria-level={3}
              className="text-base text-foreground"
            >
              Forwarding activity
            </CardTitle>
            <CardDescription className="mt-1 text-xs font-normal tracking-normal">
              Receive settlement, destination attempts, retries, and listener
              errors.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {proxyInvoices.length > 0 ? (
          <div className="grid grid-cols-3 border-b border-border/60 bg-muted/20">
            <ActivityMetric label="Payments" value={proxyInvoices.length} />
            <ActivityMetric label="Attempts" value={attemptCount} />
            <ActivityMetric
              label="Needs attention"
              value={attentionCount}
              destructive={attentionCount > 0}
            />
          </div>
        ) : null}

        {error && proxyInvoices.length === 0 ? (
          <div className="p-5">
            <Alert variant="destructive">
              <WifiOff className="size-4" aria-hidden />
              <AlertTitle>Activity unavailable</AlertTitle>
              <AlertDescription>
                The forwarding journal could not be loaded.
              </AlertDescription>
            </Alert>
          </div>
        ) : proxyInvoices.length === 0 && loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size={24} className="text-muted-foreground" />
          </div>
        ) : proxyInvoices.length === 0 ? (
          <div className="flex items-center gap-3 px-5 py-10 text-sm text-muted-foreground">
            <Clock3 className="size-5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium text-foreground">
                No proxy activity yet
              </p>
              <p className="mt-0.5 text-xs">
                Attempts will appear after the first payment is received.
              </p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {proxyInvoices.map(invoice => (
              <ProxyPaymentActivity key={invoice.id} invoice={invoice} />
            ))}
          </div>
        )}

        {retryCount > 0 ? (
          <div className="flex items-center gap-2 border-t border-border/60 bg-muted/20 px-5 py-3 text-xs text-muted-foreground">
            <RotateCcw className="size-3.5" aria-hidden />
            {retryCount.toLocaleString()} recorded{' '}
            {retryCount === 1 ? 'retry' : 'retries'} across these payments.
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ActivityMetric({
  label,
  value,
  destructive = false
}: {
  label: string
  value: number
  destructive?: boolean
}) {
  return (
    <div className="border-r border-border/60 px-4 py-3 last:border-r-0">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-lg font-semibold tabular-nums',
          destructive ? 'text-destructive' : 'text-foreground'
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  )
}

function ProxyPaymentActivity({ invoice }: { invoice: ProxyInvoice }) {
  const { proxy } = invoice
  const sourceTime = proxy.sourcePaidAt ?? invoice.paidAt ?? invoice.createdAt
  const hasWorkerLease = proxy.leaseExpiresAt !== null

  return (
    <article className="[contain-intrinsic-size:0_220px] [content-visibility:auto]">
      <header className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
            <ArrowDownLeft className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">Payment received</p>
              <ForwardingStatusBadge status={proxy.status} />
              {hasWorkerLease ? (
                <Badge
                  variant="secondary"
                  title={`Lease expires ${formatDateTime(proxy.leaseExpiresAt!)}`}
                >
                  Worker lease
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
              → {proxy.destination}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {formatDateTime(sourceTime)} · {formatRelativeTime(sourceTime)}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p className="text-sm font-semibold tabular-nums text-primary">
            +{formatMsats(proxy.grossAmountMsats)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Net {formatMsats(proxy.destinationAmountMsats)}
          </p>
        </div>
      </header>

      <div className="border-t border-border/50 bg-background/25 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Route className="size-4 text-muted-foreground" aria-hidden />
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Destination attempts
            </p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {proxy.attemptCount}{' '}
            {proxy.attemptCount === 1 ? 'attempt' : 'attempts'}
            {' · '}
            {proxy.retryCount} {proxy.retryCount === 1 ? 'retry' : 'retries'}
          </p>
        </div>

        {proxy.lastError ? (
          <Alert variant="destructive" className="mt-3 bg-destructive/5">
            <AlertTriangle className="size-4" aria-hidden />
            <AlertTitle>Latest forwarding error</AlertTitle>
            <AlertDescription className="break-words">
              {proxy.lastError}
            </AlertDescription>
          </Alert>
        ) : null}

        {proxy.attempts.length === 0 ? (
          <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
            No destination invoice attempt has been recorded. Next retry:{' '}
            <span className="text-foreground">
              {formatDateTime(proxy.nextRetryAt)}
            </span>
          </div>
        ) : (
          <ol className="mt-3 flex flex-col gap-3">
            {proxy.attempts.map(attempt => (
              <AttemptActivity
                key={attempt.id}
                attempt={attempt}
                destination={proxy.destination}
              />
            ))}
          </ol>
        )}
      </div>
    </article>
  )
}

function AttemptActivity({
  attempt,
  destination
}: {
  attempt: AddressProxyAttempt
  destination: string
}) {
  const label =
    attempt.attemptNo === 1
      ? 'Initial forward'
      : `Retry #${attempt.attemptNo - 1}`
  const when = attempt.resolvedAt ?? attempt.updatedAt

  return (
    <li className="relative rounded-lg border border-border/70 bg-card p-3 pl-10">
      <span
        className={cn(
          'absolute left-3.5 top-4 size-3 rounded-full border-2 border-card ring-1 ring-border',
          attempt.status === 'SUCCEEDED'
            ? 'bg-primary'
            : ['REJECTED', 'EXPIRED'].includes(attempt.status)
              ? 'bg-destructive'
              : 'bg-muted-foreground'
        )}
        aria-hidden
      />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{label}</p>
              <ForwardingStatusBadge status={attempt.status} />
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Attempt #{attempt.attemptNo} · {formatDateTime(attempt.createdAt)}
            </p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-medium tabular-nums">
              {formatMsats(attempt.amountMsats)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {attempt.routingFeeMsats
                ? `Routing fee ${formatMsats(attempt.routingFeeMsats)}`
                : `Updated ${formatRelativeTime(when)}`}
            </p>
          </div>
        </div>

        <p className="break-all text-xs text-muted-foreground">
          Destination{' '}
          <span className="font-mono text-foreground">{destination}</span>
        </p>

        {attempt.errorCode || attempt.errorMessage ? (
          <Alert variant="destructive" className="bg-destructive/5 py-3">
            <AlertTriangle className="size-4" aria-hidden />
            <AlertTitle>{attempt.errorCode ?? 'Forwarding error'}</AlertTitle>
            <AlertDescription className="break-words">
              {attempt.errorMessage ?? 'The outgoing attempt was not accepted.'}
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-2 rounded-md bg-muted/40 p-2 sm:grid-cols-2">
          <DebugIdentifier label="Request ID" value={attempt.requestId} />
          <DebugIdentifier label="Payment hash" value={attempt.paymentHash} />
          <DebugIdentifier
            label="Destination invoice"
            value={attempt.bolt11}
            className="sm:col-span-2"
          />
        </div>
      </div>
    </li>
  )
}

function DebugIdentifier({
  label,
  value,
  className
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
        <p
          className="truncate font-mono text-[10px] text-foreground"
          title={value}
        >
          {value}
        </p>
      </div>
      <CopyButton value={value} label={label} />
    </div>
  )
}
