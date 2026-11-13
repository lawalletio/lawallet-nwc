'use client'

import { ArrowLeftRight, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { DataTablePagination } from '@/components/admin/data-table-pagination'
import { useApi } from '@/lib/client/hooks/use-api'
import { formatDateTime, formatRelativeTime } from '@/lib/client/format'
import { cn } from '@/lib/utils'
import {
  PROVIDER_NAMES,
  PhaseBadge,
  formatArs,
  formatSats,
  swapPhase,
  type Swap,
  type SwapPhase
} from './swap-shared'

const PAGE_SIZE = 10

interface SwapPage {
  items: Swap[]
  total: number
  page: number
  pageSize: number
}

/**
 * The caller's swaps, one server page at a time. `useApi` maps
 * `/api/wallet/swaps*` to the `swaps:updated` SSE event, so rows re-render
 * live as providers settle.
 */
export function SwapsTable({
  page,
  onPageChange,
  onOpen,
  onNew
}: {
  page: number
  onPageChange: (page: number) => void
  onOpen: (id: string) => void
  onNew: () => void
}) {
  const { data, loading } = useApi<SwapPage>(
    `/api/wallet/swaps?page=${page}&pageSize=${PAGE_SIZE}`
  )
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))
  const rows = data?.items ?? []

  if (loading && !data) {
    return (
      <div className="space-y-2 rounded-xl border p-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (data && data.total === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center animate-in fade-in">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <ArrowLeftRight className="size-5" />
        </span>
        <p className="font-medium">No swaps yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Send pesos to any Argentine bank account, paid from your Lightning
          wallet.
        </p>
        <Button className="mt-2" onClick={onNew}>
          <Plus className="size-4" /> New swap
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Desktop: table. */}
      <div className="hidden overflow-hidden rounded-xl border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((swap, i) => {
              const phase = swapPhase(swap)
              return (
                <TableRow
                  key={swap.id}
                  onClick={() => onOpen(swap.id)}
                  className="cursor-pointer animate-in fade-in"
                  style={{
                    animationDelay: `${i * 30}ms`,
                    animationFillMode: 'both'
                  }}
                >
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    <span title={formatDateTime(swap.createdAt)}>
                      {formatRelativeTime(swap.createdAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="max-w-[220px]">
                      <p className="truncate text-sm font-medium">
                        {swap.holderName ?? 'Recipient'}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {swap.destination}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {PROVIDER_NAMES[swap.provider]}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {formatArs(swap.amountArs)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {formatSats(swap.amountSats)}
                  </TableCell>
                  <TableCell>
                    <LiveStatus phase={phase} />
                  </TableCell>
                  <TableCell>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards. */}
      <ul className="divide-y overflow-hidden rounded-xl border md:hidden">
        {rows.map(swap => (
          <li key={swap.id} className="animate-in fade-in">
            <button
              type="button"
              onClick={() => onOpen(swap.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {swap.holderName ?? swap.destination}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {PROVIDER_NAMES[swap.provider]} ·{' '}
                  {formatRelativeTime(swap.createdAt)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-sm font-semibold tabular-nums">
                  {formatArs(swap.amountArs)}
                </span>
                <LiveStatus phase={swapPhase(swap)} />
              </div>
            </button>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <DataTablePagination
          page={page}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      )}
    </div>
  )
}

/** Status badge; in-flight swaps get a pulsing "live" dot. */
function LiveStatus({ phase }: { phase: SwapPhase }) {
  const moving = phase === 'transferring' || phase === 'awaiting'
  return (
    <span className="inline-flex items-center gap-2">
      {moving && (
        <span className="relative flex size-2" aria-hidden>
          <span
            className={cn(
              'absolute inline-flex size-full animate-ping rounded-full opacity-60',
              phase === 'transferring' ? 'bg-amber-500' : 'bg-muted-foreground'
            )}
          />
          <span
            className={cn(
              'relative inline-flex size-2 rounded-full',
              phase === 'transferring' ? 'bg-amber-500' : 'bg-muted-foreground'
            )}
          />
        </span>
      )}
      <PhaseBadge phase={phase} />
    </span>
  )
}
