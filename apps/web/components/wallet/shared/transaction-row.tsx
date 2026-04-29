'use client'

import { ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NwcTransaction } from '@/lib/client/nwc/transactions'

interface TransactionRowProps {
  tx: NwcTransaction
  onClick?: () => void
  className?: string
}

export function TransactionRow({ tx, onClick, className }: TransactionRowProps) {
  const incoming = tx.type === 'incoming'
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight
  const timestamp = tx.settledAt ?? tx.createdAt

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/60',
        className,
      )}
    >
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          incoming
            ? 'bg-green-500/10 text-green-500'
            : 'bg-orange-500/10 text-orange-500',
        )}
      >
        <Icon className="size-4" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {tx.description || (incoming ? 'Received' : 'Sent')}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatRelative(timestamp)}
        </span>
      </div>

      <div className="text-right tabular-nums">
        <span
          className={cn(
            'text-sm font-semibold',
            incoming ? 'text-green-500' : 'text-foreground',
          )}
        >
          {incoming ? '+' : '−'}
          {tx.amountSats.toLocaleString()}
        </span>
        <span className="ml-1 text-xs text-muted-foreground">sats</span>
      </div>
    </button>
  )
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 0) return 'Just now'
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString()
}
