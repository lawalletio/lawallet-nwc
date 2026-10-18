'use client'

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  PencilLine,
  ReceiptText,
  RefreshCw,
  Route
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ui/copy-button'
import { ForwardingStatusBadge } from '@/components/wallet/shared/forwarding-status'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { LightningAddressInput } from '@/components/wallet/shared/lightning-address-input'
import type {
  AddressInvoice,
  AddressProxyAttempt
} from '@/lib/client/hooks/use-wallet-addresses'
import { useProxyForwardingMutations } from '@/lib/client/hooks/use-wallet-addresses'
import { formatDateTime, formatMsats } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/client/i18n'

interface AddressInvoiceDetailsDialogProps {
  username: string
  invoice: AddressInvoice | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => Promise<void>
}

export function AddressInvoiceDetailsDialog({
  username,
  invoice,
  open,
  onOpenChange,
  onUpdated
}: AddressInvoiceDetailsDialogProps) {
  const t = useT()
  const td = t.addresses.invoiceDetails
  const [changingDestination, setChangingDestination] = useState(false)
  const [destination, setDestination] = useState('')
  const [pendingAction, setPendingAction] = useState<
    'retry' | 'change_destination' | null
  >(null)
  const { retryForwarding, changeDestination, recovering, recoveryError } =
    useProxyForwardingMutations(username, invoice?.id ?? null)

  useEffect(() => {
    setDestination(invoice?.proxy?.destination ?? '')
    setChangingDestination(false)
    setPendingAction(null)
  }, [invoice?.id, invoice?.proxy?.destination])

  if (!invoice) return null

  const proxy = invoice.proxy
  const currentAttempt = proxy?.attempts[0] ?? null
  const canRecover = proxy?.status === 'BLOCKED' && !!proxy.lastError

  async function handleRetry() {
    setPendingAction('retry')
    try {
      const result = await retryForwarding()
      await onUpdated()
      if (result.payment?.status === 'BLOCKED') {
        toast.error(result.payment.lastError ?? td.stillBlocked)
      } else if (result.payment?.status === 'COMPLETED') {
        toast.success(td.completed)
      } else {
        toast.success(td.retryStarted)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : td.retryFailed)
    } finally {
      setPendingAction(null)
    }
  }

  async function handleDestinationChange(
    event: React.FormEvent<HTMLFormElement>
  ) {
    event.preventDefault()
    setPendingAction('change_destination')
    try {
      await changeDestination(destination.trim())
      await onUpdated()
      setChangingDestination(false)
      toast.success(td.destinationUpdated)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : td.changeFailed)
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/70 px-5 py-5 text-left sm:px-6">
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500 ring-1 ring-inset ring-emerald-500/15">
              <ArrowDownLeft className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>{proxy ? td.proxyTitle : td.title}</DialogTitle>
                <ForwardingStatusBadge
                  status={proxy?.status ?? invoice.status}
                />
              </div>
              <DialogDescription className="mt-1">
                {proxy ? td.routedTo(proxy.destination) : invoice.description}
              </DialogDescription>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xl font-semibold tabular-nums text-emerald-500">
                +{formatMsats(invoice.amountMsats)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {formatDateTime(invoice.paidAt ?? invoice.createdAt)}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 px-5 py-5 sm:px-6">
          {proxy && (
            <>
              <section aria-labelledby="payment-flow-title">
                <SectionTitle
                  id="payment-flow-title"
                  icon={Route}
                  title={td.paymentPath}
                  subtitle={td.serviceFeePct((proxy.feeBps / 100).toFixed(2))}
                />
                <div className="mt-3 grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
                  <FlowStep
                    eyebrow={td.received}
                    value={formatMsats(proxy.grossAmountMsats)}
                    detail={td.incomingInvoice}
                    tone="positive"
                  />
                  <FlowArrow />
                  <FlowStep
                    eyebrow={td.serviceFee}
                    value={`−${formatMsats(proxy.serviceFeeMsats)}`}
                    detail={td.bpsRetained(proxy.feeBps)}
                    tone="fee"
                  />
                  <FlowArrow />
                  <FlowStep
                    eyebrow={t.addresses.destination}
                    value={formatMsats(proxy.destinationAmountMsats)}
                    detail={
                      proxy.forwardedAt ? td.forwarded : td.reservedToForward
                    }
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border/80 px-3 py-2 text-xs">
                  <span className="text-muted-foreground">
                    {td.routingFeeByProxy}
                  </span>
                  <span className="font-medium tabular-nums">
                    {proxy.routingFeeMsats
                      ? formatMsats(proxy.routingFeeMsats)
                      : td.notChargedYet}
                  </span>
                </div>
              </section>

              {proxy.lastError && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-destructive">
                        {td.needsAttention}
                      </p>
                      <p className="mt-0.5 break-words text-muted-foreground">
                        {proxy.lastError}
                      </p>
                    </div>
                  </div>

                  {canRecover && (
                    <div className="mt-3 border-t border-destructive/15 pt-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleRetry()}
                          disabled={recovering}
                        >
                          <RefreshCw
                            className={cn(
                              'size-3.5',
                              pendingAction === 'retry' && 'animate-spin'
                            )}
                          />
                          {td.retryForwarding}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setChangingDestination(value => !value)
                          }
                          disabled={recovering}
                        >
                          <PencilLine className="size-3.5" />
                          {td.changeAddress}
                        </Button>
                      </div>

                      {changingDestination && (
                        <form
                          className="mt-3 rounded-lg border border-border/70 bg-background/55 p-3"
                          onSubmit={event =>
                            void handleDestinationChange(event)
                          }
                        >
                          <label
                            htmlFor={`proxy-destination-${invoice.id}`}
                            className="text-xs font-medium"
                          >
                            {td.newAddress}
                          </label>
                          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                            <LightningAddressInput
                              id={`proxy-destination-${invoice.id}`}
                              value={destination}
                              onChange={setDestination}
                              placeholder="name@example.com"
                              disabled={recovering}
                              className="h-9 font-mono text-sm"
                            />
                            <Button
                              type="submit"
                              size="sm"
                              disabled={
                                recovering ||
                                destination.trim().toLowerCase() ===
                                  proxy.destination.toLowerCase()
                              }
                            >
                              {pendingAction === 'change_destination' && (
                                <RefreshCw className="size-3.5 animate-spin" />
                              )}
                              {td.saveDestination}
                            </Button>
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                            {td.rerouteNote}
                          </p>
                          {recoveryError && (
                            <p className="mt-2 text-xs text-destructive">
                              {recoveryError.message}
                            </p>
                          )}
                        </form>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <section
            aria-labelledby="invoice-payloads-title"
            className="space-y-3"
          >
            <SectionTitle
              id="invoice-payloads-title"
              icon={ReceiptText}
              title={td.invoices}
              subtitle={proxy ? td.bothLegs : td.receiveLeg}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <InvoicePayload
                title={td.incomingInvoice}
                status={invoice.status}
                amountMsats={invoice.amountMsats}
                bolt11={invoice.bolt11}
                paymentHash={invoice.paymentHash}
                createdAt={invoice.createdAt}
                resolvedAt={invoice.paidAt}
              />
              {proxy && (
                <DestinationInvoice
                  attempt={currentAttempt}
                  expectedAmountMsats={proxy.destinationAmountMsats}
                  destination={proxy.destination}
                />
              )}
            </div>
          </section>

          {proxy && (
            <section aria-labelledby="settlement-title">
              <SectionTitle
                id="settlement-title"
                icon={Clock3}
                title={td.settlement}
                subtitle={td.forwardingAttempts(proxy.attemptCount)}
              />
              <dl className="mt-3 grid overflow-hidden rounded-xl border border-border/70 text-sm sm:grid-cols-2">
                <DetailItem
                  label={td.sourceSettled}
                  value={formatOptionalDate(proxy.sourcePaidAt, td.notYet)}
                />
                <DetailItem
                  label={td.forwarded}
                  value={formatOptionalDate(proxy.forwardedAt, td.notYet)}
                />
                <DetailItem
                  label={td.forwardedAmount}
                  value={
                    proxy.forwardedAmountMsats
                      ? formatMsats(proxy.forwardedAmountMsats)
                      : td.notForwarded
                  }
                />
                <DetailItem
                  label={td.retries}
                  value={proxy.retryCount.toLocaleString()}
                />
                <DetailItem
                  label={td.zapReceipt}
                  value={
                    proxy.receiptPublishedAt
                      ? td.published(formatDateTime(proxy.receiptPublishedAt))
                      : td.notPublished
                  }
                />
                <DetailItem
                  label={td.updated}
                  value={formatDateTime(proxy.updatedAt)}
                />
              </dl>
              {proxy.receiptEventId && (
                <div className="mt-3">
                  <CopyValue
                    label={td.zapReceiptEvent}
                    value={proxy.receiptEventId}
                  />
                </div>
              )}
            </section>
          )}

          {proxy && proxy.attempts.length > 1 && (
            <section aria-labelledby="attempt-history-title">
              <SectionTitle
                id="attempt-history-title"
                icon={Clock3}
                title={td.attemptHistory}
                subtitle={td.latestOf(
                  proxy.attempts.length,
                  proxy.attemptCount
                )}
              />
              <div className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
                {proxy.attempts.map(attempt => (
                  <div
                    key={attempt.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                  >
                    <div>
                      <span className="font-medium">
                        {t.addresses.attemptNo(attempt.attemptNo)}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        {formatDateTime(attempt.createdAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="tabular-nums">
                        {formatMsats(attempt.amountMsats)}
                      </span>
                      <ForwardingStatusBadge status={attempt.status} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FlowStep({
  eyebrow,
  value,
  detail,
  tone = 'default'
}: {
  eyebrow: string
  value: string
  detail: string
  tone?: 'default' | 'positive' | 'fee'
}) {
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        tone === 'positive' && 'border-emerald-500/25 bg-emerald-500/[0.06]',
        tone === 'fee' && 'border-amber-500/25 bg-amber-500/[0.06]',
        tone === 'default' && 'border-border/70 bg-muted/20'
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {eyebrow}
      </p>
      <p className="mt-1 text-base font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  )
}

function FlowArrow() {
  return (
    <div className="grid place-items-center text-muted-foreground/60">
      <ArrowRight className="size-4 rotate-90 sm:rotate-0" />
    </div>
  )
}

function DestinationInvoice({
  attempt,
  expectedAmountMsats,
  destination
}: {
  attempt: AddressProxyAttempt | null
  expectedAmountMsats: string
  destination: string
}) {
  const t = useT()
  const td = t.addresses.invoiceDetails
  if (!attempt) {
    return (
      <div className="flex min-h-48 flex-col rounded-xl border border-dashed border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {t.addresses.destinationInvoice}
          </p>
          <Badge variant="outline">{td.notRecorded}</Badge>
        </div>
        <div className="grid flex-1 place-items-center py-5 text-center">
          <div>
            <p className="font-mono text-sm">{destination}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {td.expectedAmount(formatMsats(expectedAmountMsats))}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <InvoicePayload
      title={td.destinationInvoiceNo(attempt.attemptNo)}
      status={attempt.status}
      amountMsats={attempt.amountMsats}
      bolt11={attempt.bolt11}
      paymentHash={attempt.paymentHash}
      createdAt={attempt.createdAt}
      resolvedAt={attempt.resolvedAt}
      error={attempt.errorMessage}
    />
  )
}

function InvoicePayload({
  title,
  status,
  amountMsats,
  bolt11,
  paymentHash,
  createdAt,
  resolvedAt,
  error
}: {
  title: string
  status: string
  amountMsats: string
  bolt11: string
  paymentHash: string
  createdAt: string
  resolvedAt: string | null
  error?: string | null
}) {
  const t = useT()
  const td = t.addresses.invoiceDetails
  return (
    <div className="rounded-xl border border-border/70 bg-muted/[0.08] p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatMsats(amountMsats)}
          </p>
        </div>
        <ForwardingStatusBadge status={status} />
      </div>
      <div className="mt-4 space-y-3">
        <CopyValue label="BOLT11" value={bolt11} multiline />
        <CopyValue label={t.addresses.paymentHash} value={paymentHash} />
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">{td.created}</p>
            <p className="mt-0.5">{formatDateTime(createdAt)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{td.resolved}</p>
            <p className="mt-0.5">
              {formatOptionalDate(resolvedAt, td.notYet)}
            </p>
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  )
}

function CopyValue({
  label,
  value,
  multiline = false
}: {
  label: string
  value: string
  multiline?: boolean
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <CopyButton value={value} label={label} className="size-6" />
      </div>
      <code
        className={cn(
          'block rounded-md bg-muted/60 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground',
          multiline ? 'max-h-24 overflow-y-auto break-all' : 'truncate'
        )}
        title={multiline ? undefined : value}
      >
        {value}
      </code>
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-border/60 px-3 py-2.5 odd:border-r-0 sm:odd:border-r [&:nth-child(n+3)]:border-t">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words tabular-nums">{value}</dd>
    </div>
  )
}

function SectionTitle({
  id,
  icon: Icon,
  title,
  subtitle
}: {
  id: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      <h3 id={id} className="text-sm font-medium">
        {title}
      </h3>
      <span className="text-xs text-muted-foreground">· {subtitle}</span>
    </div>
  )
}

function formatOptionalDate(value: string | null, notYet: string): string {
  return value ? formatDateTime(value) : notYet
}
