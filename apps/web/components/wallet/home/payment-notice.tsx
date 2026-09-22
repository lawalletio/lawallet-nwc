'use client'

import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { WalletPaymentCue } from '@/lib/client/hooks/use-wallet-payment-notice'

export function PaymentNotice({
  cue,
  amountLabel,
  unit,
  hideAmount = false
}: {
  cue: WalletPaymentCue
  amountLabel: string
  unit: string
  hideAmount?: boolean
}) {
  const incoming = cue.type === 'incoming'
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight
  const title = incoming ? 'Received' : 'Sent'

  return (
    <div
      role="status"
      aria-atomic="true"
      className={cn(
        'animate-payment-notice inline-flex max-w-full items-center gap-2 rounded-full border bg-card/95 px-3 py-1.5 shadow-lg backdrop-blur-md',
        incoming
          ? 'border-green-500/40 text-green-500'
          : 'border-orange-500/40 text-orange-500'
      )}
    >
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full',
          incoming ? 'bg-green-500/15' : 'bg-orange-500/15'
        )}
      >
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="text-xs font-semibold uppercase tracking-wide">
        {title}
      </span>
      {hideAmount ? (
        <span className="text-sm font-semibold tabular-nums text-foreground">
          •••••
        </span>
      ) : (
        <>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {incoming ? '+' : '−'}
            {amountLabel}
          </span>
          <span className="text-xs text-muted-foreground">{unit}</span>
        </>
      )}
    </div>
  )
}
