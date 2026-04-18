'use client'

import React from 'react'
import {
  ArrowDownLeft,
  Clock,
  RefreshCw,
  WifiOff,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import {
  useAddressInvoices,
  type AddressInvoice,
  type AddressInvoiceStatus,
} from '@/lib/client/hooks/use-wallet-addresses'
import { formatRelativeTime } from '@/lib/client/format'
import { cn } from '@/lib/utils'

export interface AddressInvoicesCardProps {
  /** Username of the lightning address whose invoices we're listing. */
  username: string
}

/**
 * Recent LUD-16 invoices minted for a single lightning address.
 *
 * Data comes from our own `Invoice` table via
 * `/api/wallet/addresses/[username]/invoices`, not NWC `list_transactions`
 * — that method is wallet-wide, often rate-limited, and can't be filtered
 * per address. Local invoices give us precise per-address history with
 * LUD-12 comments preserved.
 *
 * Auto-refreshes via the shared SSE `invoices:updated` event (`use-api`
 * maps this path to that event type), so a payment landing on the wallet
 * flips the row from PENDING → PAID without a manual refresh.
 */
export function AddressInvoicesCard({ username }: AddressInvoicesCardProps) {
  const { data, loading, error, refetch } = useAddressInvoices(username)
  const invoices = data?.invoices ?? []

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
        <h3 className="text-sm font-medium">Recent invoices</h3>
        <button
          type="button"
          onClick={refetch}
          disabled={loading}
          aria-label="Refresh invoices"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      {error && invoices.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-8 text-sm text-destructive">
          <WifiOff className="size-4 shrink-0" />
          <span>Couldn&rsquo;t load invoices.</span>
        </div>
      ) : invoices.length === 0 && loading ? (
        <div className="flex items-center justify-center py-10">
          <Spinner size={24} className="text-muted-foreground" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-8 text-sm text-muted-foreground">
          <Clock className="size-4 shrink-0" />
          <span>No invoices yet.</span>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {invoices.map(inv => (
            <InvoiceRow key={inv.id} invoice={inv} />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Icon + colour palette for the three invoice states. Kept as a lookup so
 * adding another state (e.g. REFUNDED) is a single map entry.
 */
const STATUS_META: Record<
  AddressInvoiceStatus,
  {
    icon: React.ComponentType<{ className?: string }>
    iconClass: string
    bgClass: string
    amountClass: string
  }
> = {
  PAID: {
    icon: CheckCircle2,
    iconClass: 'text-green-500',
    bgClass: 'bg-green-500/10',
    amountClass: 'text-green-500',
  },
  PENDING: {
    icon: ArrowDownLeft,
    iconClass: 'text-muted-foreground',
    bgClass: 'bg-muted',
    amountClass: 'text-foreground',
  },
  EXPIRED: {
    icon: XCircle,
    iconClass: 'text-muted-foreground',
    bgClass: 'bg-muted/60',
    amountClass: 'text-muted-foreground line-through',
  },
}

function InvoiceRow({ invoice }: { invoice: AddressInvoice }) {
  const meta = STATUS_META[invoice.status]
  const Icon = meta.icon
  // Paid timestamp is the interesting one; fall back to created for pending /
  // expired so the row always shows *something* useful.
  const whenIso = invoice.paidAt ?? invoice.createdAt
  // Prefer the LUD-12 comment if the payer left one — it's the only
  // per-payment context we have that's more specific than the generic
  // "Payment to @alice" description the cb route generates.
  const primaryLine =
    invoice.comment?.trim() ||
    invoice.description?.trim() ||
    'Lightning payment'

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full',
          meta.bgClass,
        )}
      >
        <Icon className={cn('size-4', meta.iconClass)} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-medium">{primaryLine}</p>
        <p className="text-xs text-muted-foreground">
          {formatRelativeTime(new Date(whenIso))}
          {invoice.status !== 'PAID' && (
            <span className="ml-2 italic">· {invoice.status.toLowerCase()}</span>
          )}
        </p>
      </div>
      <span
        className={cn(
          'shrink-0 text-sm font-semibold tabular-nums',
          meta.amountClass,
        )}
      >
        {invoice.status === 'PAID' ? '+' : ''}
        {invoice.amountSats.toLocaleString()} sats
      </span>
    </li>
  )
}
