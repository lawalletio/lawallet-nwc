'use client'

import React, { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/client/format'
import type { NwcTransaction } from '@/lib/client/nwc'

const PAGE_SIZE = 10

/**
 * Wallet activity feed, paginated 10 per page. The full (recent) transaction
 * set is fetched once by the page; this component slices it locally so paging
 * is instant and doesn't re-hit the relay.
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
            <li
              key={tx.paymentHash || `${tx.type}-${when}`}
              className="flex items-center gap-3 py-3"
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
    </div>
  )
}
