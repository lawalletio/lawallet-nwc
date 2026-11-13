'use client'

import { BadgeCheck, Building2, Hourglass, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

export type SwapProvider = 'bullbitcoin' | 'wapu'

export const PROVIDER_NAMES: Record<SwapProvider, string> = {
  bullbitcoin: 'Bull Bitcoin',
  wapu: 'Wapu'
}

/** How long the bank transfer takes once paid, when the provider states it. */
export const PROVIDER_ETA: Partial<Record<SwapProvider, string>> = {
  wapu: '5–120 min'
}

/** `GET /api/wallet/alias/[query]`. */
export interface BankAccount {
  cvu: string
  alias: string | null
  bank: string
  icon: string | null
  owners: { type: 'F' | 'J'; cuit: string; name: string }[]
}

/** `GET /api/wallet/swaps/quote`. */
export interface SwapQuote {
  provider: SwapProvider
  sats: number | null
  arsPerBtc: number | null
  minArs: number | null
  error?: string
}

/** Swap DTO (`/api/wallet/swaps*`). */
export interface Swap {
  id: string
  provider: SwapProvider
  externalId: string
  destination: string
  holderName: string | null
  amountArs: number
  amountSats: number
  bolt11: string
  paymentHash: string | null
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED' | 'CANCELED'
  providerStatus: string | null
  receiptUrl: string | null
  expiresAt: string | null
  paidAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * What the user should read for a swap. The server only knows PENDING until
 * the provider settles, so `paidAt` + `expiresAt` split it further.
 */
export type SwapPhase =
  'awaiting' | 'expired' | 'canceled' | 'transferring' | 'completed' | 'failed'

export function swapPhase(swap: Swap, now = Date.now()): SwapPhase {
  if (swap.status === 'COMPLETED') return 'completed'
  if (swap.status === 'FAILED') return 'failed'
  if (swap.status === 'EXPIRED') return 'expired'
  if (swap.status === 'CANCELED') return 'canceled'
  if (swap.paidAt) return 'transferring'
  if (swap.expiresAt && Date.parse(swap.expiresAt) < now) return 'expired'
  return 'awaiting'
}

export const PHASE_LABEL: Record<SwapPhase, string> = {
  awaiting: 'Awaiting payment',
  expired: 'Expired',
  canceled: 'Canceled',
  transferring: 'Transfer in progress',
  completed: 'Delivered',
  failed: 'Failed'
}

export function PhaseBadge({ phase }: { phase: SwapPhase }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'shrink-0',
        phase === 'completed' &&
          'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
        phase === 'failed' &&
          'border-destructive/40 bg-destructive/10 text-destructive',
        phase === 'transferring' &&
          'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
        (phase === 'awaiting' || phase === 'expired' || phase === 'canceled') &&
          'text-muted-foreground'
      )}
    >
      {PHASE_LABEL[phase]}
    </Badge>
  )
}

export const formatArs = (n: number) =>
  `ARS ${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`

export const formatSats = (n: number) => `${n.toLocaleString('en-US')} sats`

/** sats/ARS ticker — "1 sat = ARS 1,2345" — from an ARS per sat price. */
export const formatSatRate = (arsPerSat: number) =>
  arsPerSat > 0
    ? `1 sat = ARS ${arsPerSat.toLocaleString('es-AR', {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4
      })}`
    : '—'

/** sats/ARS ticker from an order's amount pair. */
export const formatRate = (ars: number, sats: number) =>
  sats > 0 ? formatSatRate(ars / sats) : '—'

/** CUIT of a person (F) is XX-DNI-X; companies have no DNI. */
export function ownerDocument(owner?: BankAccount['owners'][number]) {
  if (!owner?.cuit) return null
  if (owner.type === 'F' && /^\d{11}$/.test(owner.cuit)) {
    return `DNI ${Number(owner.cuit.slice(2, 10)).toLocaleString('es-AR')}`
  }
  return `CUIT ${owner.cuit}`
}

/** Bank logo + verified owner + CBU, as resolved by the alias lookup. */
export function BankAccountCard({
  account,
  compact
}: {
  account: BankAccount
  compact?: boolean
}) {
  const owner = account.owners[0]
  const doc = ownerDocument(owner)
  return (
    <div className="overflow-hidden rounded-xl border border-emerald-500/40 bg-emerald-500/5 animate-in fade-in zoom-in-95 duration-300">
      <div className="flex items-center gap-3 px-4 py-3">
        <BankAvatar account={account} className="size-12" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="truncate">{owner?.name || 'Unknown holder'}</span>
            <BadgeCheck
              className="size-4 shrink-0 text-emerald-500"
              aria-label="Verified holder"
            />
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {[doc, account.bank].filter(Boolean).join(' · ')}
          </div>
        </div>
      </div>
      {!compact && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-emerald-500/20 px-4 py-2.5 text-xs">
          <dt className="text-muted-foreground">CBU/CVU</dt>
          <dd className="truncate text-right font-mono">{account.cvu}</dd>
          {account.alias && (
            <>
              <dt className="text-muted-foreground">Alias</dt>
              <dd className="truncate text-right font-mono">{account.alias}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}

export function BankAvatar({
  account,
  className
}: {
  account: Pick<BankAccount, 'icon' | 'bank'>
  className?: string
}) {
  return account.icon ? (
    // Bank logos come from the alias provider's CDN.
    <img
      src={account.icon}
      alt={account.bank}
      className={cn(
        'shrink-0 rounded-full bg-white object-contain p-1.5 ring-1 ring-border',
        className
      )}
    />
  ) : (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground',
        className
      )}
    >
      <Building2 className="size-5" />
    </span>
  )
}

/** Segmented progress bar for the wizard steps. */
export function StepBar({ active, total }: { active: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
        >
          <span
            className={cn(
              'block h-full rounded-full bg-primary transition-[width] duration-500 ease-out',
              i <= active ? 'w-full' : 'w-0'
            )}
          />
        </span>
      ))}
    </div>
  )
}

/** Checklist marker: done / active / pending / failed. */
export function StepState({
  state
}: {
  state: 'done' | 'active' | 'pending' | 'failed'
}) {
  if (state === 'done') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white animate-in zoom-in-50 duration-300">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="m5 12.5 4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    )
  }
  if (state === 'failed') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-destructive text-white animate-in zoom-in-50 duration-300">
        <X className="size-3.5" strokeWidth={3} />
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Spinner size={16} className="text-primary" />
      </span>
    )
  }
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
      <span className="size-2 rounded-full bg-muted-foreground/40" />
    </span>
  )
}

export function SuccessMark() {
  return (
    <div className="swap-ring-pop">
      <svg width="76" height="76" viewBox="0 0 72 72" fill="none" aria-hidden>
        <circle cx="36" cy="36" r="26" className="fill-emerald-500/15" />
        <circle
          className="swap-check-circle stroke-emerald-500"
          cx="36"
          cy="36"
          r="26"
          strokeWidth="3"
          fill="none"
        />
        <path
          className="swap-check-mark stroke-emerald-500"
          d="M25 37.5 33 45.5 48 29"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  )
}

export function PendingMark() {
  return (
    <div className="swap-ring-pop flex size-[76px] items-center justify-center rounded-full bg-amber-500/15 text-amber-500">
      <Hourglass className="size-9 animate-pulse" />
    </div>
  )
}

export function ErrorMark() {
  return (
    <div className="swap-ring-pop flex size-[76px] items-center justify-center rounded-full bg-destructive/15 text-destructive">
      <X className="size-10" strokeWidth={2.5} />
    </div>
  )
}
