'use client'

import { Fragment, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Check, Clock, Eye, EyeOff, Share2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { Separator } from '@/components/ui/separator'
import { CurrencyToggle } from '@/components/wallet/shared/currency-toggle'
import {
  useActiveCurrencies,
  type Currency
} from '@/lib/client/currencies-store'
import { useYadioRates, type BtcRates } from '@/lib/client/use-yadio-ticker'
import { currencyUnitLabel, formatSatsAmount } from '@/lib/client/format-sats'
import {
  maskProofValue,
  type PaymentReceiptStatus
} from '@/lib/client/payment-receipt'
import { cn } from '@/lib/utils'

/** Display-currency selection used by send and receive receipts. */
export function useReceiptCurrency() {
  const activeCurrencies = useActiveCurrencies()
  const { rates } = useYadioRates()
  const [currencyCode, setCurrencyCode] = useState(
    activeCurrencies[0]?.code ?? 'SAT'
  )

  useEffect(() => {
    if (activeCurrencies.some(currency => currency.code === currencyCode)) {
      return
    }
    setCurrencyCode(activeCurrencies[0]?.code ?? 'SAT')
  }, [activeCurrencies, currencyCode])

  const selectedCurrency =
    activeCurrencies.find(currency => currency.code === currencyCode) ??
    activeCurrencies[0]
  const activeCode = selectedCurrency?.code ?? 'SAT'

  return { activeCurrencies, rates, activeCode, setCurrencyCode }
}

export async function shareReceiptText(text: string) {
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: 'Payment receipt', text })
      return
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
    }
  }

  try {
    await navigator.clipboard.writeText(text)
    toast.success('Receipt copied')
  } catch {
    toast.error('Could not share receipt')
  }
}

export function PaymentReceiptLayout({
  children,
  footer
}: {
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 pb-4 pt-8 [scrollbar-gutter:stable]">
        {children}
      </div>
      <div className="relative z-10 shrink-0 border-t border-border/60 bg-background/90 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl">
        {footer}
      </div>
    </div>
  )
}

function ReceiptStatusMark({ status }: { status: PaymentReceiptStatus }) {
  if (status === 'pending') {
    return (
      <div className="relative flex size-20 items-center justify-center">
        <span aria-hidden className="absolute inset-0 rounded-full bg-muted" />
        <Clock className="relative size-10 text-muted-foreground" />
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="relative flex size-20 items-center justify-center">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-destructive/15"
        />
        <X className="relative size-10 text-destructive" />
      </div>
    )
  }
  return (
    <div className="relative flex size-20 items-center justify-center">
      <span
        aria-hidden
        className="absolute inset-0 rounded-full bg-[var(--theme-400)]/15 animate-success-pop"
      />
      <Check className="relative size-10 text-[var(--theme-400)]" />
    </div>
  )
}

function ReceiptStatusBadge({ status }: { status: PaymentReceiptStatus }) {
  const label =
    status === 'pending'
      ? 'Pending'
      : status === 'failed'
        ? 'Failed'
        : 'Settled'
  return (
    <span
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-semibold',
        status === 'failed'
          ? 'border-destructive/40 bg-destructive/15 text-destructive'
          : status === 'pending'
            ? 'border-border bg-muted text-muted-foreground'
            : 'border-[var(--theme-300)] bg-[var(--theme-400)]/20 text-foreground'
      )}
    >
      {label}
    </span>
  )
}

export function PaymentReceiptCard({
  title,
  amountSats,
  currencyCode,
  currencies,
  rates,
  onCurrencyChange,
  status = 'settled',
  children
}: {
  title: string
  amountSats: number
  currencyCode: string
  currencies: Currency[]
  rates: BtcRates | null
  onCurrencyChange: (next: string) => void
  status?: PaymentReceiptStatus
  children?: ReactNode
}) {
  const satsSubline =
    currencyCode === 'SAT' ? null : `${amountSats.toLocaleString()} sats`

  return (
    <section className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--theme-300)] to-transparent" />

      <div className="flex flex-col items-center gap-4 px-5 pb-6 pt-8 text-center">
        <ReceiptStatusMark status={status} />

        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
          <ReceiptStatusBadge status={status} />
        </div>

        <div className="flex flex-col items-center gap-3 pt-1">
          <div aria-live="polite" className="flex flex-col items-center gap-1">
            <div className="flex max-w-full items-baseline justify-center gap-2 tabular-nums">
              <span className="whitespace-nowrap text-[clamp(1.65rem,7.2vw,2.5rem)] font-semibold leading-none text-foreground">
                {formatSatsAmount(amountSats, currencyCode, rates)}
              </span>
              <span className="shrink-0 text-base font-semibold text-muted-foreground">
                {currencyUnitLabel(currencyCode)}
              </span>
            </div>
            {satsSubline && (
              <p className="text-sm text-muted-foreground">{satsSubline}</p>
            )}
          </div>
          <CurrencyToggle
            currencies={currencies}
            value={currencyCode}
            onChange={onCurrencyChange}
          />
        </div>
      </div>

      {children ? (
        <div className="border-t border-border/70 bg-background/35 p-4">
          <div className="rounded-2xl border border-border/70 bg-card/70 p-3">
            {children}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export interface ReceiptDetailItem {
  label: string
  value: string | null
  valueClassName?: string
  /** When false, the row is omitted instead of showing Unavailable. */
  include?: boolean
}

export function ReceiptDetailList({ items }: { items: ReceiptDetailItem[] }) {
  const visible = items.filter(item => item.include !== false)

  return (
    <>
      {visible.map((item, index) => (
        <Fragment key={item.label}>
          {index > 0 ? <Separator className="my-3" /> : null}
          <ReceiptDetailRow
            label={item.label}
            value={item.value}
            valueClassName={item.valueClassName}
          />
        </Fragment>
      ))}
    </>
  )
}

export function ReceiptDetailRow({
  label,
  value,
  valueClassName
}: {
  label: string
  value: string | null
  valueClassName?: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 flex-1 text-right font-medium break-all',
          value ? 'text-foreground' : 'text-muted-foreground',
          valueClassName
        )}
      >
        {value ?? 'Unavailable'}
      </span>
    </div>
  )
}

export function PaymentProofCard({ children }: { children: ReactNode }) {
  return (
    <section className="mt-5 rounded-3xl border border-border/80 bg-card/85 p-4 shadow-sm">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Payment proof
        </p>
        <p className="text-sm text-muted-foreground">
          Reveal or copy these only when you need a receipt.
        </p>
      </div>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  )
}

export function ReceiptProofRow({
  label,
  value,
  secret = false
}: {
  label: string
  value: string | null
  secret?: boolean
}) {
  const [revealed, setRevealed] = useState(false)
  const trimmed = value?.trim() || null

  if (!trimmed) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <p className="text-sm text-muted-foreground">Not provided by wallet</p>
      </div>
    )
  }

  const display = secret && !revealed ? maskProofValue(trimmed) : trimmed

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <div className="flex items-center">
          {secret && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={
                revealed
                  ? `Hide ${label.toLowerCase()}`
                  : `Show ${label.toLowerCase()}`
              }
              aria-pressed={revealed}
              onClick={() => setRevealed(open => !open)}
            >
              {revealed ? (
                <EyeOff data-icon="inline-start" />
              ) : (
                <Eye data-icon="inline-start" />
              )}
            </Button>
          )}
          <CopyButton value={trimmed} label={label} className="size-7" />
        </div>
      </div>
      <code
        className={cn(
          'block rounded-md bg-muted/60 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground',
          secret && revealed ? 'break-all' : 'truncate',
          secret && !revealed && 'select-none'
        )}
        title={secret && !revealed ? undefined : trimmed}
      >
        {display}
      </code>
    </div>
  )
}

export function PaymentReceiptActions({
  onShare,
  onDone
}: {
  onShare: () => void
  onDone: () => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-12 flex-1"
          onClick={onShare}
        >
          <Share2 data-icon="inline-start" />
          Share
        </Button>
        <Button asChild variant="secondary" className="h-12 flex-1">
          <Link href="/wallet/activity">View activity</Link>
        </Button>
      </div>
      <Button onClick={onDone} className="h-12 w-full">
        Done
      </Button>
    </div>
  )
}
