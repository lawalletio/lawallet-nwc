'use client'

import { useEffect, useReducer, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronRight,
  Clock,
  ExternalLink,
  RefreshCw,
  X,
  Zap
} from 'lucide-react'
import { useAuth } from '@/components/admin/auth-context'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { invalidateApiPath, useApi } from '@/lib/client/hooks/use-api'
import { useVisibleInterval } from '@/lib/client/hooks/use-visible-interval'
import { formatDateTime } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import {
  BankAccountCard,
  ErrorMark,
  PROVIDER_NAMES,
  PendingMark,
  PhaseBadge,
  StepState,
  SuccessMark,
  formatArs,
  formatRate,
  PROVIDER_ETA,
  formatSats,
  swapPhase,
  type BankAccount,
  type Swap,
  type SwapPhase
} from './swap-shared'
import { SwapStepDialog, type TimelineStep } from './swap-step-dialog'
import { INVOICE, WalletPicker, useSwapPayment } from './swap-pay'

/**
 * Updates arrive over SSE (`swaps:updated`, emitted whenever the server sees
 * the provider move). This slow poll is only the nudge that makes the server
 * ask the provider while someone is watching — the listener's reconcile tick
 * covers everyone else.
 */
const NUDGE_MS = 20_000

const HEADLINE: Record<SwapPhase, string> = {
  awaiting: 'Waiting for your payment',
  expired: 'Order expired',
  canceled: 'Order canceled',
  transferring: 'Sats sent — pesos on the way',
  completed: 'Pesos delivered',
  failed: 'Transfer failed'
}

const BODY: Record<SwapPhase, string> = {
  awaiting:
    'The order is created but its Lightning invoice has not been paid yet.',
  expired: 'The invoice was never paid, so no funds moved.',
  canceled: 'You canceled this order before paying it. No funds moved.',
  transferring: 'The provider is wiring the pesos.',
  completed: 'The bank transfer was completed.',
  failed:
    'The provider reported a failure. Contact the community admin with the order id below.'
}

/**
 * Live status of one swap — a timeline that updates over SSE — with the
 * order details and a printable receipt.
 */
export function SwapTracker({
  swapId,
  onNew
}: {
  swapId: string
  onNew: () => void
}) {
  const {
    data: swap,
    refetch,
    error
  } = useApi<Swap>(`/api/wallet/swaps/${swapId}`)
  const [checking, setChecking] = useState(false)
  const [openStep, setOpenStep] = useState<TimelineStep | null>(null)
  const phase = swap ? swapPhase(swap) : null
  // Bank logo, verified holder, CBU and alias — the swap only stores the
  // destination, so resolve it again (cached by useApi).
  const { data: account } = useApi<BankAccount>(
    swap ? `/api/wallet/alias/${encodeURIComponent(swap.destination)}` : null
  )
  // Includes an order that looks expired here but the server hasn't
  // confirmed yet — the next check lets it record EXPIRED.
  const live = swap?.status === 'PENDING'
  useVisibleInterval(refetch, NUDGE_MS, live)

  // Flip an awaiting order to "expired" the moment its invoice lapses.
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const expiresAt = phase === 'awaiting' ? swap?.expiresAt : null
  useEffect(() => {
    if (!expiresAt) return
    const t = setTimeout(
      () => {
        rerender()
        void refetch()
      },
      Math.max(0, Date.parse(expiresAt) - Date.now()) + 1000
    )
    return () => clearTimeout(t)
  }, [expiresAt, refetch])

  // The detail GET asks the provider (throttled server-side to once per 10s).
  const checkStatus = async () => {
    setChecking(true)
    try {
      await refetch()
    } finally {
      setChecking(false)
    }
  }

  if (error && !swap) {
    return (
      <Card>
        <p className="text-sm text-destructive">Swap not found.</p>
        <Button className="mt-4" onClick={onNew}>
          New swap
        </Button>
      </Card>
    )
  }
  if (!swap || !phase) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-6">
          <Skeleton className="size-[76px] rounded-full" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-8 w-32" />
        </div>
      </Card>
    )
  }

  const paid = Boolean(swap.paidAt) || phase === 'completed'
  const timeline: {
    key: TimelineStep
    label: string
    detail?: string
    state: 'done' | 'active' | 'pending' | 'failed'
  }[] = [
    {
      key: 'order',
      label: 'Order created',
      detail: formatDateTime(swap.createdAt),
      state: 'done'
    },
    {
      key: 'payment',
      label: 'Lightning payment',
      detail: swap.paidAt
        ? formatDateTime(swap.paidAt)
        : phase === 'expired' || phase === 'canceled'
          ? 'Not paid'
          : undefined,
      state: paid
        ? 'done'
        : phase === 'expired' || phase === 'failed' || phase === 'canceled'
          ? 'failed'
          : 'active'
    },
    {
      key: 'transfer',
      label: `${PROVIDER_NAMES[swap.provider]} bank transfer`,
      detail:
        [
          swap.providerStatus,
          phase === 'transferring' &&
            PROVIDER_ETA[swap.provider] &&
            `est. ${PROVIDER_ETA[swap.provider]}`
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      state:
        phase === 'completed'
          ? 'done'
          : phase === 'failed'
            ? 'failed'
            : phase === 'transferring'
              ? 'active'
              : 'pending'
    },
    {
      key: 'delivered',
      label: 'Pesos delivered',
      detail:
        phase === 'completed' ? formatDateTime(swap.updatedAt) : undefined,
      state: phase === 'completed' ? 'done' : 'pending'
    }
  ]

  return (
    <Card>
      {/* Two columns once the card itself is wide enough (container query —
          the admin sidebar makes viewport breakpoints unreliable). */}
      <div className="@container">
        <div className="flex flex-col gap-6 @3xl:grid @3xl:grid-cols-2 @3xl:gap-10">
          {/* Narrow: one column in `order`. Wide: status + details left;
              payment, timeline and actions right (the column wrappers stop
              being `contents`). */}
          <div className="contents @3xl:flex @3xl:min-w-0 @3xl:flex-col @3xl:gap-6">
            <div
              key={phase}
              className="order-1 flex flex-col items-center text-center animate-in fade-in duration-300"
            >
              {phase === 'completed' ? (
                <SuccessMark />
              ) : phase === 'failed' ||
                phase === 'expired' ||
                phase === 'canceled' ? (
                <ErrorMark />
              ) : phase === 'transferring' ? (
                <PendingMark />
              ) : (
                <div className="swap-ring-pop flex size-[76px] items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Clock className="size-9" />
                </div>
              )}
              <h2 className="mt-4 text-lg font-semibold">{HEADLINE[phase]}</h2>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {formatArs(swap.amountArs)}
              </p>
              {account ? (
                <div className="mt-4 w-full max-w-sm text-left">
                  <BankAccountCard
                    account={{
                      ...account,
                      // A CBU lookup has no alias; the order may have used one.
                      alias:
                        account.alias ??
                        (/^\d{22}$/.test(swap.destination)
                          ? null
                          : swap.destination)
                    }}
                  />
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">
                  to {swap.holderName ?? swap.destination}
                </p>
              )}
              {/* Awaiting: the note sits on the pay panel instead. */}
              {phase !== 'awaiting' && (
                <p className="mt-3 max-w-sm text-xs text-muted-foreground">
                  {BODY[phase]}
                  {phase === 'transferring' &&
                    (PROVIDER_ETA[swap.provider]
                      ? ` Estimated arrival: ${PROVIDER_ETA[swap.provider]}.`
                      : ' Bank transfers usually land within minutes.')}
                </p>
              )}
            </div>

            <dl className="order-4 space-y-2 rounded-xl border bg-muted/30 p-4 text-sm">
              <Row label="Status" value={<PhaseBadge phase={phase} />} />
              <Row label="Destination" value={swap.destination} mono />
              <Row label="You paid" value={formatSats(swap.amountSats)} />
              <Row
                label="Rate (sats/ARS)"
                value={formatRate(swap.amountArs, swap.amountSats)}
              />
              <Row label="Provider" value={PROVIDER_NAMES[swap.provider]} />
              <Row label="Order" value={swap.id} mono />
            </dl>
          </div>

          <div className="contents @3xl:flex @3xl:min-w-0 @3xl:flex-col @3xl:gap-6">
            {/* Actions: top right when wide, top of the card when narrow. */}
            <div className="order-first empty:hidden">
              {live && (
                <div className="flex flex-wrap justify-end gap-2">
                  {live && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={checkStatus}
                      disabled={checking}
                    >
                      <RefreshCw
                        className={cn('size-4', checking && 'animate-spin')}
                      />
                      {checking ? 'Checking…' : 'Check status'}
                    </Button>
                  )}
                  {phase === 'awaiting' && (
                    <CancelOrderButton swapId={swap.id} onCanceled={refetch} />
                  )}
                </div>
              )}
            </div>
            {phase === 'awaiting' && (
              <div className="order-2">
                <PayPanel swap={swap} />
              </div>
            )}
            <ol className="order-3">
              {timeline.map((t, i) => (
                <li
                  key={t.label}
                  className="relative flex gap-3 pb-5 last:pb-0"
                >
                  {i < timeline.length - 1 && (
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-3 top-7 -bottom-0 w-px -translate-x-1/2 transition-colors duration-500',
                        t.state === 'done' ? 'bg-emerald-500' : 'bg-border'
                      )}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setOpenStep(t.key)}
                    className="group flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    aria-haspopup="dialog"
                  >
                    <StepState state={t.state} />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p
                        className={cn(
                          'text-sm transition-colors group-hover:text-primary',
                          t.state === 'pending'
                            ? 'text-muted-foreground'
                            : 'font-medium'
                        )}
                      >
                        {t.label}
                      </p>
                      {t.detail && (
                        <p className="truncate text-xs text-muted-foreground">
                          {t.detail}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100" />
                  </button>
                </li>
              ))}
            </ol>
            {swap.receiptUrl && <BankReceipt url={swap.receiptUrl} />}
            <SwapStepDialog
              step={openStep}
              state={timeline.find(t => t.key === openStep)?.state ?? 'pending'}
              swap={swap}
              phase={phase}
              account={account ?? null}
              onClose={() => setOpenStep(null)}
            />
          </div>
        </div>
      </div>
    </Card>
  )
}

/** Drop an unpaid order, after a confirm. */
function CancelOrderButton({
  swapId,
  onCanceled
}: {
  swapId: string
  onCanceled: () => Promise<void>
}) {
  const { apiClient } = useAuth()
  const [busy, setBusy] = useState(false)

  async function cancel() {
    setBusy(true)
    try {
      await apiClient.post(`/api/wallet/swaps/${swapId}/cancel`, {})
      invalidateApiPath('/api/wallet/swaps')
      await onCanceled()
      toast.success('Order canceled')
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : 'Could not cancel the order'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={busy}
        >
          {busy ? <Spinner size={16} /> : <X className="size-4" />}
          Cancel order
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this order?</AlertDialogTitle>
          <AlertDialogDescription>
            No funds have moved. Don&apos;t pay this invoice afterwards — if you
            already scanned it elsewhere, check that wallet first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep order</AlertDialogCancel>
          <AlertDialogAction
            onClick={cancel}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Cancel order
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const PAY_STEP = ['', 'Connecting to wallet…', 'Paying…', 'Confirming…']

/** Pay a created-but-unpaid order from one of the user's wallets. */
function PayPanel({ swap }: { swap: Swap }) {
  const payment = useSwapPayment(swap.amountSats)
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const paying = step > 0

  async function pay() {
    setError(null)
    try {
      await payment.pay(swap, setStep)
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'The payment did not go through'
      )
    } finally {
      setStep(0)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <p className="text-xs text-muted-foreground">{BODY.awaiting}</p>
      <WalletPicker payment={payment} bolt11={swap.bolt11} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      {payment.method !== INVOICE && (
        <Button
          className="h-11 w-full"
          disabled={paying || !payment.canPay}
          onClick={pay}
        >
          {paying ? <Spinner size={16} /> : <Zap className="size-4" />}
          {paying ? PAY_STEP[step] : `Pay ${formatSats(swap.amountSats)}`}
        </Button>
      )}
      {swap.expiresAt && (
        <p className="text-center text-xs text-muted-foreground">
          Invoice expires {formatDateTime(swap.expiresAt)}
        </p>
      )}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {children}
    </section>
  )
}

function Row({
  label,
  value,
  mono
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'min-w-0 truncate text-right font-medium',
          mono && 'font-mono text-xs'
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/** The provider's transfer receipt (Wapu sends an image), shown inline. */
function BankReceipt({ url }: { url: string }) {
  const [broken, setBroken] = useState(false)
  return (
    <figure className="order-3 space-y-2 animate-in fade-in duration-300">
      <figcaption className="flex items-center justify-between text-sm font-medium">
        Bank receipt
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
        >
          Open <ExternalLink className="size-3.5" />
        </a>
      </figcaption>
      {broken ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block rounded-xl border px-4 py-3 text-sm text-primary underline-offset-2 hover:underline"
        >
          View the bank receipt
        </a>
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          {/* Provider-hosted receipt image. */}
          <img
            src={url}
            alt="Bank transfer receipt"
            onError={() => setBroken(true)}
            className="max-h-[28rem] w-full rounded-xl border bg-white object-contain"
          />
        </a>
      )}
    </figure>
  )
}
