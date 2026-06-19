'use client'

import React, { useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/client/format'
import type { NwcTransaction } from '@/lib/client/nwc'

const PAGE_SIZE = 10

/**
 * Wallet activity feed, paginated 10 per page. The full (recent) transaction
 * set is fetched once by the page; this component slices it locally so paging
 * is instant and doesn't re-hit the relay. Tapping a row opens a detail dialog
 * (amount, fee, status, description, payment hash, preimage).
 */
export function WalletTransactionsList({
  transactions,
  loading,
  error,
}: {
  transactions: NwcTransaction[]
  loading: boolean
  error: Error | null
}) {
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<NwcTransaction | null>(null)

  if (loading && transactions.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        Couldn’t load transactions — the wallet may be unreachable.
      </p>
    )
  }

  if (transactions.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No transactions yet.
      </p>
    )
  }

  const pageCount = Math.ceil(transactions.length / PAGE_SIZE)
  const current = Math.min(page, pageCount - 1)
  const rows = transactions.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)

  return (
    <div className="flex flex-col">
      <ul className="divide-y divide-border">
        {rows.map(tx => {
          const incoming = tx.type === 'incoming'
          const when = tx.settledAt ?? tx.createdAt
          return (
            <li key={tx.paymentHash || `${tx.type}-${when}`}>
              <button
                type="button"
                onClick={() => setSelected(tx)}
                className="-mx-1 flex w-full items-center gap-3 rounded-md px-1 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full',
                    incoming
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-amber-500/10 text-amber-500',
                  )}
                >
                  {incoming ? (
                    <ArrowDownLeft className="size-4" />
                  ) : (
                    <ArrowUpRight className="size-4" />
                  )}
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">
                    {tx.description || (incoming ? 'Received' : 'Sent')}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(new Date(when).toISOString())}
                    {tx.settledAt == null && ' · pending'}
                  </span>
                </div>
                <span
                  className={cn(
                    'shrink-0 text-sm font-medium tabular-nums',
                    incoming ? 'text-emerald-500' : 'text-foreground',
                  )}
                >
                  {incoming ? '+' : '−'}
                  {tx.amountSats.toLocaleString()}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">sats</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">
            Page {current + 1} of {pageCount}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft className="size-4" />
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={selected != null} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-md">
          {selected && <TransactionDetail tx={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TransactionDetail({ tx }: { tx: NwcTransaction }) {
  const incoming = tx.type === 'incoming'
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full',
              incoming
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-amber-500/10 text-amber-500',
            )}
          >
            {incoming ? (
              <ArrowDownLeft className="size-4" />
            ) : (
              <ArrowUpRight className="size-4" />
            )}
          </span>
          {incoming ? 'Received' : 'Sent'}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="text-center">
          <span
            className={cn(
              'text-3xl font-semibold tabular-nums',
              incoming ? 'text-emerald-500' : 'text-foreground',
            )}
          >
            {incoming ? '+' : '−'}
            {tx.amountSats.toLocaleString()}
          </span>
          <span className="ml-1.5 text-base text-muted-foreground">sats</span>
        </div>

        <dl className="flex flex-col divide-y divide-border text-sm">
          <DetailRow
            label="Status"
            value={
              <Badge variant={tx.settledAt ? 'default' : 'secondary'}>
                {tx.settledAt ? 'Settled' : 'Pending'}
              </Badge>
            }
          />
          <DetailRow label="Date" value={formatFull(tx.settledAt ?? tx.createdAt)} />
          {tx.description && <DetailRow label="Description" value={tx.description} />}
          {!incoming && tx.feesPaidSats > 0 && (
            <DetailRow
              label="Fee paid"
              value={`${tx.feesPaidSats.toLocaleString()} sats`}
            />
          )}
          {tx.paymentHash && <CopyRow label="Payment hash" value={tx.paymentHash} />}
          {tx.preimage && <CopyRow label="Preimage" value={tx.preimage} />}
        </dl>
      </div>
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  )
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(`${label} copied`)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy failed')
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5">
        <code className="truncate font-mono text-xs">{value}</code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={copy}
          aria-label={`Copy ${label}`}
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-500" />
          ) : (
            <Copy className="size-3.5" />
          )}
        </Button>
      </dd>
    </div>
  )
}

function formatFull(ms: number): string {
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
