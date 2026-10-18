'use client'

import Link from 'next/link'
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react'
import { useLocale, useT, type Dict } from '@/lib/client/i18n'
import { cn } from '@/lib/utils'
import type { NwcTransaction } from '@/lib/client/nwc/transactions'
import { rememberActivityTx } from '@/lib/client/activity-detail-store'

interface TransactionRowProps {
  tx: NwcTransaction
  href?: string
  className?: string
}

export function TransactionRow({ tx, href, className }: TransactionRowProps) {
  const t = useT()
  const locale = useLocale()
  const incoming = tx.type === 'incoming'
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight
  const timestamp = tx.settledAt ?? tx.createdAt
  const title =
    tx.description || (incoming ? t.shared.tx.received : t.shared.tx.sent)

  function remember() {
    rememberActivityTx(tx)
  }

  const classNames = cn(
    'flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-accent/60',
    className
  )

  const body = (
    <>
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          incoming
            ? 'bg-green-500/10 text-green-500'
            : 'bg-orange-500/10 text-orange-500'
        )}
      >
        <Icon className="size-4" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatRelative(timestamp, t, locale)}
        </span>
      </div>

      <div className="text-right tabular-nums">
        <span
          className={cn(
            'text-sm font-semibold',
            incoming ? 'text-green-500' : 'text-foreground'
          )}
        >
          {incoming ? '+' : '−'}
          {tx.amountSats.toLocaleString()}
        </span>
        <span className="ml-1 text-xs text-muted-foreground">sats</span>
      </div>
    </>
  )

  if (href) {
    return (
      <Link
        href={href}
        // Each row is a distinct dynamic route; viewport prefetch fired one
        // request per visible row (1.3k/day in Sentry). Detail is cheap to load.
        prefetch={false}
        onClick={remember}
        onPointerDown={remember}
        aria-label={`${title}, ${incoming ? '+' : '−'}${tx.amountSats.toLocaleString()} sats`}
        className={classNames}
      >
        {body}
      </Link>
    )
  }

  return <div className={classNames}>{body}</div>
}

function formatRelative(ms: number, t: Dict, locale: string): string {
  const s = t.shared.tx
  const diff = Date.now() - ms
  if (diff < 0) return s.justNow
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return s.justNow
  if (minutes < 60) return s.minutesAgo(minutes)
  const hours = Math.round(minutes / 60)
  if (hours < 24) return s.hoursAgo(hours)
  const days = Math.round(hours / 24)
  if (days < 7) return s.daysAgo(days)
  return new Date(ms).toLocaleDateString(locale)
}
