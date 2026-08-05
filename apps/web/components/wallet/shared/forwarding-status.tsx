'use client'

import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { humanizeStatus } from '@/lib/client/format'
import { cn } from '@/lib/utils'

type Tone = 'positive' | 'negative' | 'pending' | 'neutral'

/**
 * One classification for every forwarding-related status the wallet surfaces:
 * receipts, legs, attempts, invoices and notification deliveries. Keeping it in
 * one place is what stops the same status rendering green in one tab and grey
 * in the next.
 */
const TONES: Record<string, Tone> = {
  COMPLETED: 'positive',
  SUCCEEDED: 'positive',
  PAID: 'positive',
  SETTLED: 'positive',
  RETAINED: 'positive',
  BLOCKED: 'negative',
  REJECTED: 'negative',
  EXPIRED: 'negative',
  FAILED: 'negative',
  RECEIVED: 'pending',
  FORWARDING: 'pending',
  PARTIAL: 'pending',
  PENDING: 'pending',
  READY: 'pending',
  UNKNOWN: 'pending'
}

export function forwardingStatusTone(status: string): Tone {
  return TONES[status.toUpperCase()] ?? 'neutral'
}

export function ForwardingStatusBadge({
  status,
  className
}: {
  status: string
  className?: string
}) {
  const tone = forwardingStatusTone(status)
  return (
    <Badge
      variant={tone === 'negative' ? 'destructive' : 'outline'}
      className={cn(
        'shrink-0 text-[10px] [&_svg]:mr-1 [&_svg]:size-3',
        tone === 'positive' && 'border-primary/30 bg-primary/10 text-primary',
        tone === 'pending' && 'bg-muted text-muted-foreground',
        tone === 'neutral' && 'bg-muted text-muted-foreground',
        className
      )}
    >
      {tone === 'positive' ? <CheckCircle2 data-icon="inline-start" /> : null}
      {humanizeStatus(status)}
    </Badge>
  )
}

export function ForwardingStatusIcon({
  status,
  size = 10,
  busyLabel = 'Payment forwarding in progress'
}: {
  status: string
  size?: 8 | 10
  busyLabel?: string
}) {
  const tone = forwardingStatusTone(status)
  const busy = tone === 'pending'
  return (
    <span
      role={busy ? 'status' : undefined}
      aria-label={busy ? busyLabel : undefined}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full',
        size === 8 ? 'size-8' : 'size-10',
        tone === 'positive' && 'bg-emerald-500/10 text-emerald-500',
        tone === 'negative' && 'bg-destructive/10 text-destructive',
        (tone === 'pending' || tone === 'neutral') &&
          'bg-amber-500/10 text-amber-500'
      )}
    >
      {tone === 'positive' ? (
        <CheckCircle2 className={size === 8 ? 'size-4' : 'size-5'} />
      ) : tone === 'negative' ? (
        <AlertTriangle className={size === 8 ? 'size-4' : 'size-5'} />
      ) : (
        <Spinner
          size={size === 8 ? 16 : 24}
          color="yellow"
          aria-hidden="true"
        />
      )}
    </span>
  )
}
