'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FastForward,
  FileJson,
  GitBranch,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Settings2,
  Trash2,
  WalletCards
} from 'lucide-react'
import { toast } from 'sonner'
import {
  WalletTransactionDetail,
  ZapEventJson
} from '@/components/admin/remote-wallet/transactions-list'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  CursorPagination,
  useCursorPagination
} from '@/components/wallet/shared/cursor-pagination'
import {
  ForwardingStatusBadge,
  ForwardingStatusIcon
} from '@/components/wallet/shared/forwarding-status'
import { formatDateTime, formatMsats } from '@/lib/client/format'
import {
  useRemoteWalletForwardingMutations,
  useRemoteWalletForwardActivity,
  useRemoteWalletForwardReceipts,
  useRemoteWalletPayment,
  useRemoteWalletReceiveAction,
  type ForwardActivityData,
  type ForwardReceiptData,
  type ReceiveActionDestination,
  type RemoteWalletReceiveActionData,
  type RemoteWalletZapData
} from '@/lib/client/hooks/use-remote-wallet-forwarding'
import type { NwcTransaction } from '@/lib/client/nwc'
import {
  mergeReceivedPayments,
  type ReceivedPaymentRow
} from '@/lib/client/received-payments'
import { cn } from '@/lib/utils'

const FORWARDING_PAGE_SIZE = 5
const RECEIPT_LOOKUP_LIMIT = 100

export function RemoteWalletForwardingPanel({
  walletId,
  transactions = [],
  transactionsLoading = false,
  transactionsError = null,
  walletActive = true
}: {
  walletId: string
  transactions?: NwcTransaction[]
  transactionsLoading?: boolean
  transactionsError?: Error | null
  /** Inactive wallets are never polled, so "no payments" would be a lie. */
  walletActive?: boolean
}) {
  const action = useRemoteWalletReceiveAction(walletId)
  const activityPagination = useCursorPagination()
  const receipts = useRemoteWalletForwardReceipts(walletId, {
    limit: RECEIPT_LOOKUP_LIMIT
  })
  const activity = useRemoteWalletForwardActivity(walletId, {
    cursor: activityPagination.cursor,
    limit: FORWARDING_PAGE_SIZE
  })
  const mutations = useRemoteWalletForwardingMutations(walletId)
  const [activeTab, setActiveTab] = useState('overview')
  const [configOpen, setConfigOpen] = useState(false)
  const [queuedForwarding, setQueuedForwarding] = useState<{
    startedAt: number
    amountMsats: number
    destinations: string[]
  } | null>(null)
  const [paymentsPage, setPaymentsPage] = useState(0)
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(
    null
  )
  const [selectedTransaction, setSelectedTransaction] =
    useState<NwcTransaction | null>(null)
  const selectedReceipt =
    receipts.data?.receipts.find(receipt => receipt.id === selectedReceiptId) ??
    null
  const receivedPayments = useMemo(
    () =>
      mergeReceivedPayments(
        transactions,
        receipts.data?.receipts ?? [],
        action.data
          ? {
              enabled: action.data.enabled,
              enabledAt: action.data.enabledAt
            }
          : null
      ),
    [transactions, receipts.data?.receipts, action.data]
  )
  const paymentsPageCount = Math.max(
    1,
    Math.ceil(receivedPayments.length / FORWARDING_PAGE_SIZE)
  )
  const currentPaymentsPage = Math.min(paymentsPage, paymentsPageCount - 1)
  const visiblePayments = receivedPayments.slice(
    currentPaymentsPage * FORWARDING_PAGE_SIZE,
    (currentPaymentsPage + 1) * FORWARDING_PAGE_SIZE
  )
  const forwardActivity = useMemo(
    () => activity.data?.activity ?? [],
    [activity.data?.activity]
  )
  // The server flag covers every attempt, not only the ones on the activity
  // page currently rendered.
  const attemptInProgress =
    action.data?.attemptInProgress === true || queuedForwarding != null

  // The forced run is acknowledged before the background reconciler has
  // fetched a destination invoice and persisted its first attempt. Keep a
  // clearly-labelled local progress row until the durable attempt arrives via
  // SSE, so the user never lands on an empty Forwarding tab after clicking.
  useEffect(() => {
    if (!queuedForwarding) return
    if (
      forwardActivity.some(
        entry =>
          Date.parse(entry.createdAt) >= queuedForwarding.startedAt - 1_000
      )
    ) {
      setQueuedForwarding(null)
    }
  }, [forwardActivity, queuedForwarding])

  async function refetchForwarding() {
    await Promise.all([receipts.refetch(), activity.refetch()])
  }

  async function toggle(enabled: boolean) {
    try {
      await mutations.setEnabled(enabled)
      toast.success(enabled ? 'Forwarding resumed' : 'Forwarding paused')
      await Promise.all([action.refetch(), refetchForwarding()])
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not update forwarding'
      )
    }
  }

  async function forceForward() {
    const startedAt = Date.now()
    activityPagination.reset()
    setActiveTab('activity')
    setQueuedForwarding({
      startedAt,
      amountMsats: action.data?.pendingAmountMsats ?? 0,
      destinations:
        action.data?.revision?.destinations.map(
          destination => destination.address
        ) ?? []
    })
    try {
      const result = await mutations.forceForward()
      toast.success(
        `Forwarding started for ${result.forwardingReceipts} pending ${result.forwardingReceipts === 1 ? 'receipt' : 'receipts'}`
      )
      await Promise.all([action.refetch(), refetchForwarding()])
    } catch (error) {
      setQueuedForwarding(null)
      toast.error(
        error instanceof Error ? error.message : 'Could not start forwarding'
      )
    }
  }

  if (action.loading && !action.data) {
    return (
      <div className="flex justify-center rounded-2xl border py-16">
        <Spinner />
      </div>
    )
  }
  if (action.error || !action.data) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive">
        Forwarding settings are unavailable.
      </div>
    )
  }

  const data = action.data
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card/60 shadow-[0_30px_80px_-60px_hsl(var(--primary))]">
      <div className="flex flex-col gap-4 border-b border-border/60 bg-gradient-to-br from-amber-500/10 via-card to-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 ring-1 ring-amber-500/25">
            <GitBranch className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">On receive · Forward</h2>
              <StateBadge action={data} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Retain a fee in this wallet and distribute every new receipt.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.configured && data.pendingReceipts > 0 && (
            <Button
              variant="secondary"
              onClick={() => void forceForward()}
              disabled={!data.enabled || mutations.forcing || attemptInProgress}
              title={
                !data.enabled
                  ? 'Resume forwarding first'
                  : attemptInProgress
                    ? 'A forwarding attempt is already in progress'
                    : 'Forward all currently pending funds now'
              }
            >
              {mutations.forcing || attemptInProgress ? (
                <Spinner
                  data-icon="inline-start"
                  size={16}
                  aria-hidden="true"
                />
              ) : (
                <FastForward data-icon="inline-start" />
              )}
              {mutations.forcing || attemptInProgress
                ? 'Forwarding…'
                : 'Force Forward'}
            </Button>
          )}
          {data.configured && (
            <Button
              variant="outline"
              onClick={() => void toggle(!data.enabled)}
              disabled={mutations.loading}
            >
              {data.enabled ? (
                <Pause data-icon="inline-start" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              {data.enabled ? 'Pause' : 'Resume'}
            </Button>
          )}
          <Button
            onClick={() => setConfigOpen(true)}
            disabled={!data.eligible}
            title={data.reason ?? undefined}
          >
            <Settings2 data-icon="inline-start" />
            {data.configured ? 'Edit plan' : 'Configure'}
          </Button>
        </div>
      </div>

      {!data.eligible && (
        <div className="m-5 flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {data.reason}
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="h-auto w-full justify-start gap-1 rounded-none border-b bg-transparent px-4 pt-2">
          <TabsTrigger value="overview" className="gap-2 rounded-b-none">
            <WalletCards className="size-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-2 rounded-b-none">
            <CircleDollarSign className="size-4" />
            Payments received
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2 rounded-b-none">
            <Activity className="size-4" />
            Forwarding
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="m-0 p-5">
          <Overview action={data} />
        </TabsContent>
        <TabsContent value="payments" className="m-0">
          <ReceivedPaymentsList
            rows={visiblePayments}
            loading={receipts.loading || transactionsLoading}
            error={transactionsError}
            walletActive={walletActive}
            onOpenReceipt={receipt => setSelectedReceiptId(receipt.id)}
            onOpenTransaction={setSelectedTransaction}
          />
          <CursorPagination
            label="payments"
            page={currentPaymentsPage + 1}
            hasNext={currentPaymentsPage < paymentsPageCount - 1}
            loading={receipts.loading || transactionsLoading}
            onPrevious={() =>
              setPaymentsPage(Math.max(0, currentPaymentsPage - 1))
            }
            onNext={() =>
              setPaymentsPage(
                Math.min(paymentsPageCount - 1, currentPaymentsPage + 1)
              )
            }
          />
        </TabsContent>
        <TabsContent value="activity" className="m-0">
          <ForwardingActivity
            activity={forwardActivity}
            loading={activity.loading}
            queuedForwarding={queuedForwarding}
          />
          <CursorPagination
            label="forwarding"
            page={activityPagination.page}
            hasNext={Boolean(activity.data?.nextCursor)}
            loading={activity.loading}
            onPrevious={activityPagination.previous}
            onNext={() => activityPagination.next(activity.data?.nextCursor)}
          />
        </TabsContent>
      </Tabs>

      {configOpen && (
        <ForwardingConfigDialog
          open
          onOpenChange={setConfigOpen}
          action={data}
          onSave={async input => {
            await mutations.configure(input)
            await Promise.all([action.refetch(), refetchForwarding()])
          }}
          loading={mutations.loading}
        />
      )}
      <ForwardReceiptDialog
        receipt={selectedReceipt}
        open={Boolean(selectedReceipt)}
        onOpenChange={open => !open && setSelectedReceiptId(null)}
        retrying={mutations.loading}
        onRetry={async receipt => {
          try {
            await mutations.retryReceipt(receipt.id)
            toast.success('Forwarding retry queued')
            await refetchForwarding()
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : 'Could not retry'
            )
          }
        }}
      />
      <RemoteWalletPaymentDialog
        walletId={walletId}
        transaction={selectedTransaction}
        onOpenChange={open => !open && setSelectedTransaction(null)}
      />
    </section>
  )
}

function RemoteWalletPaymentDialog({
  walletId,
  transaction,
  onOpenChange
}: {
  walletId: string
  transaction: NwcTransaction | null
  onOpenChange: (open: boolean) => void
}) {
  const payment = useRemoteWalletPayment(
    walletId,
    transaction?.paymentHash ?? null
  )
  return (
    <Dialog open={transaction != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {transaction && (
          <WalletTransactionDetail
            tx={transaction}
            zap={payment.data?.zap ?? null}
            zapLoading={payment.loading && Boolean(transaction.paymentHash)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function Overview({ action }: { action: RemoteWalletReceiveActionData }) {
  if (!action.revision) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <GitBranch className="size-8 text-muted-foreground" />
        <p className="font-medium">No forwarding plan yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Add one or more Lightning Addresses and choose how the net amount is
          split.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Pending balance"
          value={formatMsats(String(action.pendingAmountMsats))}
          accent
        />
        <Metric label="Open receipts" value={String(action.pendingReceipts)} />
        <Metric
          label="Entry fee"
          value={`${(action.revision.feeBps / 100).toFixed(2)}% + ${action.revision.baseFeeSats} sat`}
        />
        <Metric
          label="Routing reserve"
          value={`${(action.routingReserveBps / 100).toFixed(2)}% + ${action.routingReserveBaseSats} sat`}
        />
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Destinations
        </div>
        <div className="divide-y overflow-hidden rounded-xl border">
          {action.revision.destinations.map(destination => (
            <div
              key={destination.address}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="min-w-0 truncate font-mono text-sm">
                {destination.address}
              </span>
              <Badge variant="secondary">
                {(destination.allocationBps / 100).toFixed(2)}%
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  accent
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="rounded-xl border bg-background/50 p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-2 text-xl font-semibold tabular-nums',
          accent && 'text-amber-500'
        )}
      >
        {value}
      </div>
    </div>
  )
}


function ReceivedPaymentsList({
  rows,
  loading,
  error,
  walletActive,
  onOpenReceipt,
  onOpenTransaction
}: {
  rows: ReceivedPaymentRow[]
  loading: boolean
  error: Error | null
  walletActive: boolean
  onOpenReceipt: (receipt: ForwardReceiptData) => void
  onOpenTransaction: (transaction: NwcTransaction) => void
}) {
  if (loading && rows.length === 0)
    return (
      <div className="flex justify-center py-14">
        <Spinner />
      </div>
    )
  if (rows.length === 0)
    return (
      <EmptyActivity
        text={
          error
            ? 'Could not load wallet payments. Forwarding receipts will appear when available.'
            : !walletActive
              ? 'Payment activity is only available while the wallet is active.'
              : 'No payments have been received by this wallet yet.'
        }
      />
    )
  return (
    <div>
      {error && (
        <div className="border-b border-amber-500/20 bg-amber-500/5 px-5 py-2 text-xs text-amber-700 dark:text-amber-300">
          The live wallet history is unavailable; showing known forwarding
          receipts.
        </div>
      )}
      <div className="divide-y">
        {rows.map(row => {
          const receipt = row.receipt
          const transaction = row.transaction
          const amountSats = receipt
            ? receipt.grossAmountMsats / 1000
            : (transaction?.amountSats ?? 0)
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => {
                if (receipt) onOpenReceipt(receipt)
                else if (transaction) onOpenTransaction(transaction)
              }}
              className="group flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-accent/50"
            >
              {receipt ? (
                <ForwardingStatusIcon status={receipt.status} />
              ) : row.awaitingForwarding ? (
                <ForwardingStatusIcon
                  status="AWAITING_FORWARDING"
                  busyLabel="Waiting to be forwarded"
                />
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                  <ArrowDownLeft className="size-5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">
                    {transaction?.description || 'Payment received'}
                  </span>
                  {receipt ? (
                    <ForwardingStatusBadge status={receipt.status} />
                  ) : row.awaitingForwarding ? (
                    <ForwardingStatusBadge status="AWAITING_FORWARDING" />
                  ) : (
                    <Badge variant="outline">regular</Badge>
                  )}
                </div>
                {receipt?.comment && (
                  <p className="mt-1 line-clamp-2 border-l-2 border-border pl-2 text-xs italic text-muted-foreground">
                    “{receipt.comment}”
                  </p>
                )}
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(row.timestamp)}
                  {receipt
                    ? ` · ${receipt.legs.length} destination${receipt.legs.length === 1 ? '' : 's'}`
                    : transaction?.settledAt == null
                      ? ' · pending'
                      : ''}
                </div>
                {receipt?.lastError && (
                  <div className="mt-1 line-clamp-2 text-xs text-destructive">
                    {receipt.lastError}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums text-emerald-500">
                  +
                  {amountSats.toLocaleString(undefined, {
                    maximumFractionDigits: 3
                  })}{' '}
                  sats
                </div>
                <div className="text-xs text-muted-foreground">
                  {receipt
                    ? `sent ${formatMsats(String(receipt.forwardedAmountMsats))}`
                    : row.awaitingForwarding
                      ? 'not forwarded yet'
                      : 'kept in wallet'}
                </div>
              </div>
              <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ForwardingActivity({
  activity,
  loading,
  queuedForwarding
}: {
  activity: ForwardActivityData[]
  loading: boolean
  queuedForwarding: {
    startedAt: number
    amountMsats: number
    destinations: string[]
  } | null
}) {
  if (loading && activity.length === 0)
    return (
      <div className="flex justify-center py-14">
        <Spinner />
      </div>
    )
  if (activity.length === 0 && !queuedForwarding)
    return (
      <EmptyActivity text="Attempts and retries will appear here in real time." />
    )
  return (
    <div className="divide-y">
      {queuedForwarding && (
        <div className="flex gap-3 bg-amber-500/5 px-5 py-4">
          <span
            role="status"
            aria-label="Forwarding attempt in progress"
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-500"
          >
            <Spinner
              size={16}
              color="yellow"
              className="motion-reduce:animate-none"
              aria-hidden="true"
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Attempt processing</span>
              <Badge variant="outline">PENDING</Badge>
            </div>
            <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {queuedForwarding.destinations.length === 0
                ? 'Preparing destination payment'
                : `Preparing ${queuedForwarding.destinations.length} destination${queuedForwarding.destinations.length === 1 ? '' : 's'}`}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            {formatDateTime(new Date(queuedForwarding.startedAt).toISOString())}
            <div className="mt-1 tabular-nums">
              {formatMsats(String(queuedForwarding.amountMsats))} pending
            </div>
          </div>
        </div>
      )}
      {activity.map(entry => {
        const inProgress =
          entry.status === 'PENDING' || entry.status === 'UNKNOWN'
        return (
          <div key={entry.id} className="flex gap-3 px-5 py-4">
            <span
              role={inProgress ? 'status' : undefined}
              aria-label={
                inProgress ? 'Forwarding attempt in progress' : undefined
              }
              className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                entry.status === 'SUCCEEDED'
                  ? 'bg-emerald-500/10 text-emerald-500'
                  : entry.status === 'PENDING' || entry.status === 'UNKNOWN'
                    ? 'bg-amber-500/10 text-amber-500'
                    : 'bg-destructive/10 text-destructive'
              )}
            >
              {entry.status === 'SUCCEEDED' ? (
                <CheckCircle2 className="size-4" />
              ) : inProgress ? (
                <Spinner
                  size={16}
                  color="yellow"
                  className="motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <RotateCcw className="size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Attempt {entry.attemptNo}</span>
                <Badge variant="outline">{entry.status}</Badge>
              </div>
              <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {entry.destination}
              </div>
              {entry.errorMessage && (
                <div className="mt-2 text-sm text-destructive">
                  {entry.errorMessage}
                </div>
              )}
            </div>
            <div className="text-right text-xs text-muted-foreground">
              {formatDateTime(entry.createdAt)}
              <div className="mt-1 tabular-nums">
                {formatMsats(String(entry.amountMsats))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ForwardingConfigDialog({
  open,
  onOpenChange,
  action,
  onSave,
  loading
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: RemoteWalletReceiveActionData
  onSave: (input: {
    feeBps: number
    baseFeeSats: number
    enabled?: boolean
    destinations: ReceiveActionDestination[]
  }) => Promise<void>
  loading: boolean
}) {
  const revision = action.revision
  const [feePercent, setFeePercent] = useState(() =>
    ((revision?.feeBps ?? 50) / 100).toFixed(2)
  )
  const [baseFee, setBaseFee] = useState(() =>
    String(revision?.baseFeeSats ?? 1)
  )
  const [destinations, setDestinations] = useState<
    Array<{ id: number; address: string; percent: string }>
  >(
    () =>
      revision?.destinations.map((destination, index) => ({
        id: index,
        address: destination.address,
        percent: String(destination.allocationBps / 100)
      })) ?? [{ id: 0, address: '', percent: '100' }]
  )
  const total = destinations.reduce(
    (sum, destination) => sum + (Number(destination.percent) || 0),
    0
  )
  const addresses = destinations.map(destination =>
    destination.address.trim().toLowerCase()
  )
  const duplicated = addresses.some(
    (address, index) => address && addresses.indexOf(address) !== index
  )
  const valid =
    Math.abs(total - 100) < 0.001 &&
    !duplicated &&
    destinations.every(
      destination =>
        destination.address.trim() && Number(destination.percent) > 0
    )
  async function submit() {
    if (!valid) return
    try {
      await onSave({
        feeBps: Math.round(Number(feePercent) * 100),
        baseFeeSats: Number(baseFee),
        enabled: true,
        destinations: destinations.map(destination => ({
          address: destination.address.trim(),
          allocationBps: Math.round(Number(destination.percent) * 100)
        }))
      })
      toast.success('Forwarding plan saved and enabled')
      onOpenChange(false)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not save forwarding plan'
      )
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Forward incoming payments</DialogTitle>
          <DialogDescription>
            The entry fee stays in this wallet. Routing fees are reported
            separately. Changes apply atomically to unpaid forwarding balances.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="forward-fee">Percentage fee</Label>
            <div className="relative">
              <Input
                id="forward-fee"
                type="number"
                min="0"
                max="10"
                step="0.01"
                value={feePercent}
                onChange={event => setFeePercent(event.target.value)}
              />
              <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">
                %
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="forward-base-fee">Base fee</Label>
            <div className="relative">
              <Input
                id="forward-base-fee"
                type="number"
                min="0"
                step="1"
                value={baseFee}
                onChange={event => setBaseFee(event.target.value)}
              />
              <span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">
                sats
              </span>
            </div>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label>Destinations</Label>
            <Badge variant={valid ? 'secondary' : 'destructive'}>
              {total.toFixed(2)}%
            </Badge>
          </div>
          {destinations.map((destination, index) => (
            <div
              key={destination.id}
              className="grid grid-cols-[minmax(0,1fr)_6rem_auto] gap-2"
            >
              <Input
                aria-label={`Destination ${index + 1}`}
                placeholder="name@example.com"
                value={destination.address}
                onChange={event =>
                  setDestinations(rows =>
                    rows.map((row, rowIndex) =>
                      rowIndex === index
                        ? { ...row, address: event.target.value }
                        : row
                    )
                  )
                }
              />
              <div className="relative">
                <Input
                  aria-label={`Allocation ${index + 1}`}
                  type="number"
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={destination.percent}
                  onChange={event =>
                    setDestinations(rows =>
                      rows.map((row, rowIndex) =>
                        rowIndex === index
                          ? { ...row, percent: event.target.value }
                          : row
                      )
                    )
                  }
                />
                <span className="pointer-events-none absolute right-2 top-2.5 text-xs text-muted-foreground">
                  %
                </span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={destinations.length === 1}
                onClick={() =>
                  setDestinations(rows =>
                    rows.filter((_, rowIndex) => rowIndex !== index)
                  )
                }
              >
                <Trash2 className="size-4" />
                <span className="sr-only">Remove destination</span>
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setDestinations(rows => [
                ...rows,
                {
                  id: rows.reduce((max, row) => Math.max(max, row.id), -1) + 1,
                  address: '',
                  percent: '0'
                }
              ])
            }
          >
            <Plus data-icon="inline-start" />
            Add destination
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || loading}>
            {loading && <Spinner data-icon="inline-start" size={16} />}
            {action.enabled ? 'Save changes' : 'Save and enable'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ForwardReceiptDialog({
  receipt,
  open,
  onOpenChange,
  onRetry,
  retrying
}: {
  receipt: ForwardReceiptData | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRetry: (receipt: ForwardReceiptData) => Promise<void>
  retrying: boolean
}) {
  const payment = useRemoteWalletPayment(
    receipt?.walletId ?? null,
    receipt?.sourcePaymentHash ?? null
  )
  if (!receipt) return null
  const retryable = receipt.legs.some(leg =>
    ['READY', 'REJECTED', 'EXPIRED'].includes(leg.status)
  )
  const zap = payment.data?.zap ?? null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-4xl">
        <DialogHeader className="px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>Forwarding receipt</DialogTitle>
            <ForwardingStatusBadge status={receipt.status} />
          </div>
          <DialogDescription>
            {formatDateTime(receipt.sourceSettledAt)} · revision{' '}
            {receipt.configRevision}
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="overview" className="min-h-0">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-y bg-muted/20 px-5 py-2 sm:px-6">
            <TabsTrigger value="overview" className="shrink-0 gap-2">
              <WalletCards className="size-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="destinations" className="shrink-0 gap-2">
              <GitBranch className="size-4" />
              Destinations
            </TabsTrigger>
            <TabsTrigger value="zap-request" className="shrink-0 gap-2">
              <FileJson className="size-4" />
              Zap request
            </TabsTrigger>
            <TabsTrigger value="zap-receipt" className="shrink-0 gap-2">
              <Radio className="size-4" />
              Zap receipt
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="m-0 space-y-4 p-5 sm:p-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Metric
                label="Received"
                value={formatMsats(String(receipt.grossAmountMsats))}
              />
              <Metric
                label="Service fee retained"
                value={formatMsats(String(receipt.retainedFeeMsats))}
              />
              <Metric
                label="Forwarded"
                value={formatMsats(String(receipt.forwardedAmountMsats))}
                accent
              />
              <Metric
                label="Routing reserve"
                value={formatMsats(String(receipt.routingReserveMsats))}
              />
              <Metric
                label="Actual routing fee"
                value={formatMsats(String(receipt.routingFeeMsats))}
              />
              <Metric
                label="Unused reserve"
                value={formatMsats(String(receipt.unusedRoutingReserveMsats))}
              />
              <Metric
                label="Destination shortfall"
                value={formatMsats(String(receipt.shortfallMsats))}
              />
            </div>
            {receipt.lastError && (
              <div className="flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                {receipt.lastError}
              </div>
            )}
            {receipt.comment && (
              <div className="rounded-xl border bg-background/40 p-4">
                <p className="text-xs font-medium text-muted-foreground">
                  Payer comment
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm italic">
                  “{receipt.comment}”
                </p>
              </div>
            )}
            <div className="grid gap-3 rounded-xl border bg-background/40 p-4 sm:grid-cols-2">
              <AuditValue
                label="Source payment hash"
                value={receipt.sourcePaymentHash}
              />
              <AuditValue label="Listener event" value={receipt.eventKey} />
              <AuditValue
                label="Recovered event"
                value={receipt.recovered ? 'Yes' : 'No'}
              />
              <AuditValue
                label={`Applied revision ${receipt.configRevision}`}
                value={
                  receipt.revision
                    ? `${(receipt.revision.feeBps / 100).toFixed(2)}% + ${receipt.revision.baseFeeSats} sat`
                    : 'Configuration snapshot unavailable'
                }
              />
              <AuditValue
                label="Source invoice"
                value={receipt.sourceInvoice ?? 'Not reported'}
              />
            </div>
          </TabsContent>
          <TabsContent
            value="destinations"
            className="m-0 space-y-3 p-5 sm:p-6"
          >
            <ForwardReceiptLegs receipt={receipt} />
          </TabsContent>
          <TabsContent value="zap-request" className="m-0 p-5 sm:p-6">
            <ZapAuditDocument
              loading={payment.loading}
              label="Kind 9734 event"
              value={zap?.requestJson ?? null}
              empty="No zap request was attached to this payment."
            />
          </TabsContent>
          <TabsContent value="zap-receipt" className="m-0 p-5 sm:p-6">
            <ZapReceiptDocument loading={payment.loading} zap={zap} />
          </TabsContent>
        </Tabs>
        <DialogFooter className="border-t px-5 py-4 sm:px-6">
          {retryable && (
            <Button onClick={() => void onRetry(receipt)} disabled={retrying}>
              {retrying ? (
                <Spinner data-icon="inline-start" size={16} />
              ) : (
                <RotateCcw data-icon="inline-start" />
              )}
              Retry failed legs
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ForwardReceiptLegs({ receipt }: { receipt: ForwardReceiptData }) {
  return receipt.legs.map(leg => (
    <div key={leg.id} className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm">{leg.destination}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {(leg.allocationBps / 100).toFixed(2)}% · requested{' '}
            {formatMsats(String(leg.requestedAmountMsats))} · forwarded{' '}
            {formatMsats(String(leg.forwardedAmountMsats ?? 0))} · reserved{' '}
            {formatMsats(String(leg.routingReserveMsats))} · routing fee{' '}
            {formatMsats(String(leg.routingFeeMsats ?? 0))} · unused{' '}
            {formatMsats(String(leg.unusedRoutingReserveMsats))} · destination
            shortfall {formatMsats(String(leg.destinationShortfallMsats))}
          </div>
        </div>
        <Badge variant="outline">{leg.status}</Badge>
      </div>
      {(leg.attempts ?? []).length > 0 && (
        <div className="mt-3 space-y-2 border-t pt-3">
          {leg.attempts?.map(attempt => (
            <details
              key={attempt.id}
              className="rounded-lg border bg-background/50 p-3 text-xs text-muted-foreground"
            >
              <summary className="cursor-pointer font-medium text-foreground">
                {leg.batchAnchorId ? 'Batch attempt' : 'Attempt'}{' '}
                {attempt.attemptNo} · {attempt.status} ·{' '}
                {formatMsats(String(attempt.amountMsats))}
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <AuditValue label="Request ID" value={attempt.requestId} />
                <AuditValue label="Payment hash" value={attempt.paymentHash} />
                <AuditValue label="BOLT11" value={attempt.bolt11} />
                <AuditValue
                  label="Preimage"
                  value={attempt.preimage ?? 'Not available'}
                />
                <AuditValue
                  label="Routing reserve"
                  value={formatMsats(String(attempt.routingReserveMsats))}
                />
                <AuditValue
                  label="Routing fee"
                  value={formatMsats(String(attempt.routingFeeMsats ?? 0))}
                />
                {leg.routingFeeOverageMsats > 0 && (
                  <AuditValue
                    label="Routing fee over reserve"
                    value={formatMsats(String(leg.routingFeeOverageMsats))}
                    destructive
                  />
                )}
                <AuditValue
                  label="Expires"
                  value={formatDateTime(attempt.expiresAt)}
                />
                {(attempt.errorCode || attempt.errorMessage) && (
                  <div className="sm:col-span-2">
                    <AuditValue
                      label={attempt.errorCode ?? 'Error'}
                      value={attempt.errorMessage ?? 'Rejected'}
                      destructive
                    />
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  ))
}

function ZapAuditDocument({
  loading,
  label,
  value,
  empty
}: {
  loading: boolean
  label: string
  value: string | null
  empty: string
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
        <Spinner size={16} />
        Loading zap audit…
      </div>
    )
  }
  if (!value) return <EmptyActivity text={empty} />
  return <ZapEventJson label={label} value={value} />
}

function ZapReceiptDocument({
  loading,
  zap
}: {
  loading: boolean
  zap: RemoteWalletZapData | null
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground">
        <Spinner size={16} />
        Loading zap receipt…
      </div>
    )
  }
  if (!zap) {
    return <EmptyActivity text="This payment did not include a zap request." />
  }
  if (!zap.receiptJson) {
    return (
      <div className="space-y-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2 font-medium text-amber-500">
          <Clock3 className="size-4" />
          Zap receipt pending
        </div>
        <p className="text-sm text-muted-foreground">
          {zap.error ?? 'Awaiting listener-confirmed settlement.'}
        </p>
        {zap.nextRetryAt && (
          <p className="text-xs text-muted-foreground">
            Next retry {formatDateTime(zap.nextRetryAt)}
          </p>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border bg-background/40 p-4 sm:grid-cols-2">
        <AuditValue
          label="Receipt event ID"
          value={zap.receiptEventId ?? 'Not published'}
        />
        <AuditValue
          label="Published"
          value={
            zap.receiptPublishedAt
              ? formatDateTime(zap.receiptPublishedAt)
              : 'Not published'
          }
        />
      </div>
      <ZapEventJson label="Kind 9735 event" value={zap.receiptJson} />
    </div>
  )
}

function AuditValue({
  label,
  value,
  destructive
}: {
  label: string
  value: string
  destructive?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-[0.68rem] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 break-all font-mono text-xs text-foreground',
          destructive && 'text-destructive'
        )}
      >
        {value}
      </div>
    </div>
  )
}

function StateBadge({ action }: { action: RemoteWalletReceiveActionData }) {
  if (!action.configured) return <Badge variant="outline">Not configured</Badge>
  return action.enabled ? (
    <Badge className="bg-emerald-600">Live</Badge>
  ) : (
    <Badge variant="secondary">Paused</Badge>
  )
}
function EmptyActivity({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-sm text-muted-foreground">
      <Activity className="size-7" />
      <p>{text}</p>
    </div>
  )
}
