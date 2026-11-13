'use client'

import { useState } from 'react'
import {
  Banknote,
  Download,
  ExternalLink,
  Landmark,
  Receipt,
  Zap
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { formatDateTime, formatRelativeTime } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import {
  BankAccountCard,
  PROVIDER_ETA,
  PROVIDER_NAMES,
  formatArs,
  formatRate,
  formatSats,
  type BankAccount,
  type Swap,
  type SwapPhase,
  type SwapProvider
} from './swap-shared'

export type TimelineStep = 'order' | 'payment' | 'transfer' | 'delivered'
export type StepState = 'done' | 'active' | 'pending' | 'failed'

const PROVIDER_ABOUT: Record<SwapProvider, { blurb: string; site: string }> = {
  wapu: {
    blurb:
      'Wapu converts the sats to pesos and sends them by instant bank transfer. Minimum ARS 10,000; usually lands in 5–120 min.',
    site: 'https://wapu.app'
  },
  bullbitcoin: {
    blurb:
      'Bull Bitcoin sells the sats for pesos and pays out to a CBU/CVU. Orders use the community’s Bull Bitcoin account.',
    site: 'https://www.bullbitcoin.com'
  }
}

const STATE_LABEL: Record<StepState, string> = {
  done: 'Done',
  active: 'In progress',
  pending: 'Not yet',
  failed: 'Did not happen'
}

/**
 * Details behind one timeline step: the provider order, the Lightning
 * invoice, the bank transfer, or the delivered pesos with their receipt.
 */
export function SwapStepDialog({
  step,
  state,
  swap,
  phase,
  account,
  onClose
}: {
  step: TimelineStep | null
  state: StepState
  swap: Swap
  phase: SwapPhase
  account: BankAccount | null
  onClose: () => void
}) {
  const provider = PROVIDER_NAMES[swap.provider]
  const meta: Record<
    TimelineStep,
    { title: string; description: string; icon: typeof Zap }
  > = {
    order: {
      title: 'Order created',
      description: `${provider} quoted the swap and froze the price.`,
      icon: Receipt
    },
    payment: {
      title: 'Lightning payment',
      description: 'The invoice that funds the order.',
      icon: Zap
    },
    transfer: {
      title: `${provider} bank transfer`,
      description: 'The provider wires the pesos to the recipient.',
      icon: Landmark
    },
    delivered: {
      title: 'Pesos delivered',
      description: 'The transfer reached the recipient’s account.',
      icon: Banknote
    }
  }
  const m = step ? meta[step] : null

  return (
    <Dialog open={step !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent
        // DialogContent is a grid: without a minmax(0,1fr) track the long
        // bolt11 / hashes would size the column and scroll sideways.
        className="max-h-[90dvh] max-w-md grid-cols-[minmax(0,1fr)] gap-0 overflow-y-auto overflow-x-hidden p-0"
      >
        {m && step && (
          <>
            <DialogHeader className="space-y-0 border-b px-5 py-4 text-left">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-full',
                    state === 'done' && 'bg-emerald-500/15 text-emerald-500',
                    state === 'active' && 'bg-primary/15 text-primary',
                    state === 'pending' && 'bg-muted text-muted-foreground',
                    state === 'failed' && 'bg-destructive/15 text-destructive'
                  )}
                >
                  <m.icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <DialogTitle className="text-base">{m.title}</DialogTitle>
                  <DialogDescription className="text-xs">
                    {m.description}
                  </DialogDescription>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    'mr-6 shrink-0',
                    state === 'done' &&
                      'border-emerald-500/40 text-emerald-600 dark:text-emerald-400',
                    state === 'active' && 'border-primary/40 text-primary',
                    state === 'failed' &&
                      'border-destructive/40 text-destructive'
                  )}
                >
                  {STATE_LABEL[state]}
                </Badge>
              </div>
            </DialogHeader>
            <div
              key={step}
              className="space-y-4 px-5 py-4 animate-in fade-in slide-in-from-bottom-1 duration-200"
            >
              {step === 'order' && <OrderBody swap={swap} />}
              {step === 'payment' && <PaymentBody swap={swap} phase={phase} />}
              {step === 'transfer' && (
                <TransferBody swap={swap} account={account} />
              )}
              {step === 'delivered' && (
                <DeliveredBody swap={swap} phase={phase} />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function OrderBody({ swap }: { swap: Swap }) {
  const about = PROVIDER_ABOUT[swap.provider]
  return (
    <>
      <div className="rounded-xl border bg-muted/30 p-3 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{PROVIDER_NAMES[swap.provider]}</span>
          <a
            href={about.site}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Website <ExternalLink className="size-3" />
          </a>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{about.blurb}</p>
      </div>
      <Rows>
        <Row label="Provider order" value={swap.externalId} mono copy />
        <Row label="Created" value={formatDateTime(swap.createdAt)} />
        <Row label="Amount" value={formatArs(swap.amountArs)} />
        <Row label="Price" value={formatSats(swap.amountSats)} />
        <Row label="Rate" value={formatRate(swap.amountArs, swap.amountSats)} />
        {PROVIDER_ETA[swap.provider] && (
          <Row label="Delivery time" value={PROVIDER_ETA[swap.provider]!} />
        )}
        <Row label="LaWallet order" value={swap.id} mono copy />
      </Rows>
    </>
  )
}

function PaymentBody({ swap, phase }: { swap: Swap; phase: SwapPhase }) {
  const payable = phase === 'awaiting'
  return (
    <>
      {payable && (
        <a
          href={`lightning:${swap.bolt11}`}
          className="mx-auto block w-fit rounded-xl bg-white p-3"
          aria-label="Open invoice in a Lightning wallet"
        >
          <QRCodeSVG value={swap.bolt11.toUpperCase()} size={192} level="M" />
        </a>
      )}
      <Rows>
        <Row label="Amount" value={formatSats(swap.amountSats)} />
        <Row
          label="Status"
          value={
            swap.paidAt
              ? `Paid ${formatDateTime(swap.paidAt)}`
              : phase === 'completed'
                ? 'Paid'
                : phase === 'expired'
                  ? 'Expired unpaid'
                  : phase === 'canceled'
                    ? 'Canceled unpaid'
                    : 'Waiting for payment'
          }
        />
        {swap.expiresAt && (
          <Row label="Expires" value={formatDateTime(swap.expiresAt)} />
        )}
        {swap.paymentHash && (
          <Row label="Payment hash" value={swap.paymentHash} mono copy />
        )}
      </Rows>
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">Invoice</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
            {swap.bolt11}
          </code>
          <CopyButton value={swap.bolt11} label="Invoice" variant="secondary" />
        </div>
      </div>
    </>
  )
}

function TransferBody({
  swap,
  account
}: {
  swap: Swap
  account: BankAccount | null
}) {
  return (
    <>
      {account ? (
        <BankAccountCard account={account} />
      ) : (
        <Rows>
          <Row label="Recipient" value={swap.holderName ?? '—'} />
          <Row label="Destination" value={swap.destination} mono copy />
        </Rows>
      )}
      <Rows>
        <Row label="Amount" value={formatArs(swap.amountArs)} />
        <Row label="Provider status" value={swap.providerStatus ?? '—'} />
        <Row label="Transfer id" value={swap.externalId} mono copy />
        {PROVIDER_ETA[swap.provider] && (
          <Row label="Usually takes" value={PROVIDER_ETA[swap.provider]!} />
        )}
        <Row label="Last checked" value={formatRelativeTime(swap.updatedAt)} />
      </Rows>
    </>
  )
}

function DeliveredBody({ swap, phase }: { swap: Swap; phase: SwapPhase }) {
  const [broken, setBroken] = useState(false)
  if (phase !== 'completed') {
    return (
      <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Not delivered yet.
        {phase === 'transferring' && PROVIDER_ETA[swap.provider]
          ? ` Transfers usually land in ${PROVIDER_ETA[swap.provider]}.`
          : ''}
      </p>
    )
  }
  return (
    <>
      <Rows>
        <Row label="Delivered" value={formatDateTime(swap.updatedAt)} />
        <Row label="Amount" value={formatArs(swap.amountArs)} />
        <Row label="To" value={swap.holderName ?? swap.destination} />
      </Rows>
      {swap.receiptUrl ? (
        <div className="space-y-3">
          {!broken && (
            <a
              href={swap.receiptUrl}
              target="_blank"
              rel="noreferrer"
              className="block"
            >
              {/* Provider-hosted receipt image. */}
              <img
                src={swap.receiptUrl}
                alt="Bank transfer receipt"
                onError={() => setBroken(true)}
                className="max-h-[50dvh] w-full rounded-xl border bg-white object-contain"
              />
            </a>
          )}
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => downloadReceipt(swap.receiptUrl!, swap.id)}
            >
              <Download className="size-4" /> Download receipt
            </Button>
            <Button asChild variant="outline">
              <a href={swap.receiptUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Open
              </a>
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          The provider didn’t send a bank receipt for this transfer.
        </p>
      )}
    </>
  )
}

/**
 * Saves the provider's receipt. A cross-origin image can only be saved when
 * its host allows CORS; otherwise it opens in a new tab to save from there.
 */
async function downloadReceipt(url: string, swapId: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    const ext = blob.type.split('/')[1]?.split('+')[0] || 'png'
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `bank-receipt-${swapId}.${ext}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
  } catch {
    window.open(url, '_blank', 'noopener')
  }
}

function Rows({ children }: { children: React.ReactNode }) {
  return (
    <dl className="divide-y rounded-xl border text-sm [&>div]:px-3 [&>div]:py-2">
      {children}
    </dl>
  )
}

function Row({
  label,
  value,
  mono,
  copy
}: {
  label: string
  value: string
  mono?: boolean
  copy?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            'truncate text-right font-medium',
            mono && 'font-mono text-xs'
          )}
          title={value}
        >
          {value}
        </span>
        {copy && <CopyButton value={value} label={label} className="size-7" />}
      </dd>
    </div>
  )
}
