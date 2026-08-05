'use client'

import React, { useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileJson,
  Radio,
  Zap
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
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
  error
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
  const rows = transactions.slice(
    current * PAGE_SIZE,
    current * PAGE_SIZE + PAGE_SIZE
  )

  return (
    <div className="flex flex-col">
      <ul className="divide-y divide-border">
        {rows.map(tx => {
          const incoming = tx.type === 'incoming'
          const when = tx.settledAt ?? tx.createdAt
          return (
            <li key={`${tx.type}:${tx.paymentHash || when}`}>
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
                      : 'bg-amber-500/10 text-amber-500'
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
                    incoming ? 'text-emerald-500' : 'text-foreground'
                  )}
                >
                  {incoming ? '+' : '−'}
                  {tx.amountSats.toLocaleString()}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    sats
                  </span>
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

      <Dialog
        open={selected != null}
        onOpenChange={open => !open && setSelected(null)}
      >
        <DialogContent className="sm:max-w-md">
          {selected && <WalletTransactionDetail tx={selected} />}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export interface WalletTransactionZap {
  request: unknown
  requestJson: string
  receipt: unknown | null
  receiptJson: string | null
  receiptEventId: string | null
  receiptPublishedAt: string | null
  error: string | null
  nextRetryAt: string | null
}

export function WalletTransactionDetail({
  tx,
  zap = null,
  zapLoading = false
}: {
  tx: NwcTransaction
  zap?: WalletTransactionZap | null
  zapLoading?: boolean
}) {
  const incoming = tx.type === 'incoming'
  const [artifact, setArtifact] = useState<'request' | 'receipt' | null>(null)
  const artifactJson =
    artifact === 'request' ? zap?.requestJson : zap?.receiptJson
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-7 shrink-0 items-center justify-center rounded-full',
              incoming
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-amber-500/10 text-amber-500'
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
              incoming ? 'text-emerald-500' : 'text-foreground'
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
          <DetailRow
            label="Date"
            value={formatFull(tx.settledAt ?? tx.createdAt)}
          />
          {tx.description && (
            <DetailRow label="Description" value={tx.description} />
          )}
          {!incoming && tx.feesPaidSats > 0 && (
            <DetailRow
              label="Fee paid"
              value={`${tx.feesPaidSats.toLocaleString()} sats`}
            />
          )}
          {tx.paymentHash && (
            <CopyRow label="Payment hash" value={tx.paymentHash} />
          )}
          {tx.preimage && <CopyRow label="Preimage" value={tx.preimage} />}
        </dl>

        {(zap || zapLoading) && (
          <section className="overflow-hidden rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-background to-background">
            <div className="flex items-start gap-3 border-b border-amber-500/15 px-4 py-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
                <Zap className="size-4" />
              </span>
              <div className="min-w-0">
                <div className="font-medium">NIP-57 zap audit</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Signed request and receipt are retained with this payment.
                </p>
              </div>
            </div>
            {zapLoading ? (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <Spinner size={16} />
                Loading zap artefacts…
              </div>
            ) : zap ? (
              <div className="divide-y divide-amber-500/15">
                <ZapArtifactRow
                  icon={<FileJson className="size-4" />}
                  title="Zap request"
                  detail="Kind 9734 · captured with the invoice"
                  badge="Captured"
                  onOpen={() => setArtifact('request')}
                />
                <ZapArtifactRow
                  icon={<Radio className="size-4" />}
                  title="Zap receipt"
                  detail={receiptDetail(zap)}
                  badge={zap.receiptEventId ? 'Published' : 'Pending'}
                  pending={!zap.receiptEventId}
                  onOpen={
                    zap.receiptJson ? () => setArtifact('receipt') : undefined
                  }
                />
              </div>
            ) : null}
          </section>
        )}
      </div>
      <Dialog
        open={artifact !== null}
        onOpenChange={open => !open && setArtifact(null)}
      >
        <DialogContent className="max-h-[85vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {artifact === 'request' ? 'Zap request' : 'Zap receipt'}
            </DialogTitle>
          </DialogHeader>
          {artifactJson && (
            <ZapEventJson
              label={
                artifact === 'request' ? 'Kind 9734 event' : 'Kind 9735 event'
              }
              value={artifactJson}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function ZapArtifactRow({
  icon,
  title,
  detail,
  badge,
  pending = false,
  onOpen
}: {
  icon: React.ReactNode
  title: string
  detail: string
  badge: string
  pending?: boolean
  onOpen?: () => void
}) {
  const content = (
    <>
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-lg',
          pending
            ? 'bg-amber-500/10 text-amber-500'
            : 'bg-emerald-500/10 text-emerald-500'
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {detail}
        </span>
      </span>
      <Badge variant={pending ? 'secondary' : 'default'}>{badge}</Badge>
    </>
  )
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-amber-500/5"
    >
      {content}
    </button>
  ) : (
    <div className="flex items-center gap-3 px-4 py-3">{content}</div>
  )
}

export function ZapEventJson({
  label,
  value
}: {
  label: string
  value: string
}) {
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
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          {copied ? (
            <Check data-icon="inline-start" />
          ) : (
            <Copy data-icon="inline-start" />
          )}
          {copied ? 'Copied' : 'Copy JSON'}
        </Button>
      </div>
      <pre className="max-h-[52vh] overflow-auto rounded-xl border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-muted-foreground">
        {prettyJson(value)}
      </pre>
    </div>
  )
}

function prettyJson(value: string) {
  try {
    return JSON.stringify(decodeNestedJson(JSON.parse(value)), null, 2)
  } catch {
    return value
  }
}

function decodeNestedJson(value: unknown, depth = 0): unknown {
  if (depth >= 4) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return decodeNestedJson(JSON.parse(trimmed), depth + 1)
      } catch {
        return value
      }
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map(item => decodeNestedJson(item, depth + 1))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        decodeNestedJson(item, depth + 1)
      ])
    )
  }
  return value
}

function receiptDetail(zap: WalletTransactionZap) {
  if (zap.receiptEventId) {
    return zap.receiptPublishedAt
      ? `Kind 9735 · ${formatFull(Date.parse(zap.receiptPublishedAt))}`
      : 'Kind 9735 · published to requested relays'
  }
  if (zap.error) {
    return zap.nextRetryAt
      ? `Retrying after ${formatFull(Date.parse(zap.nextRetryAt))}: ${zap.error}`
      : zap.error
  }
  return 'Awaiting listener-confirmed settlement'
}

function DetailRow({
  label,
  value
}: {
  label: string
  value: React.ReactNode
}) {
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
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}
