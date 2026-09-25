'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Nfc } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { BoltcardNfcPhase } from '@/lib/client/hooks/use-boltcard-nfc'

const CONFETTI_COLORS = [
  'hsl(var(--primary))',
  '#F5A623',
  '#E53935',
  '#A78BFA',
  '#ffffff'
]

const CONFIRM_SLOW_MS = 20_000

/**
 * Celebration shown once the BoltCard callback accepts the invoice on screen.
 * Settlement still arrives through the existing NWC watcher, which then opens
 * the receive summary.
 */
export function BoltcardAccepted({ amountSats }: { amountSats: number }) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), CONFIRM_SLOW_MS)
    return () => clearTimeout(timer)
  }, [])
  const confetti = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => {
        const r = (n: number) => ((Math.sin(i * 9301 + n * 49297) + 1) / 2) % 1
        return {
          left: `${Math.round(r(1) * 100)}%`,
          delay: `${(r(2) * 0.45).toFixed(2)}s`,
          duration: `${(1.6 + r(3) * 1.1).toFixed(2)}s`,
          dx: `${Math.round((r(4) - 0.5) * 160)}px`,
          rot: `${Math.round(360 + r(5) * 720)}deg`,
          size: 6 + Math.round(r(6) * 6),
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          round: r(7) > 0.55
        }
      }),
    []
  )

  return (
    <div
      className="relative flex w-full flex-col items-center overflow-hidden py-4"
      role="status"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {confetti.map((piece, i) => (
          <span
            key={i}
            className="absolute top-0 block"
            style={{
              left: piece.left,
              width: piece.size,
              height: piece.size,
              background: piece.color,
              borderRadius: piece.round ? '9999px' : '2px',
              animation: `confetti-fall ${piece.duration} linear ${piece.delay} forwards`,
              ['--dx' as string]: piece.dx,
              ['--rot' as string]: piece.rot
            }}
          />
        ))}
      </div>

      <div className="animate-success-pop relative grid size-24 place-items-center">
        <span className="animate-ring-expand absolute inset-0 rounded-full border-2 border-primary" />
        <span
          className="animate-ring-expand absolute inset-0 rounded-full border-2 border-primary"
          style={{ animationDelay: '0.45s' }}
        />
        <span
          className="grid size-20 place-items-center rounded-full border border-[var(--theme-300)] bg-gradient-to-b from-[var(--theme-200)] to-[var(--theme-400)] text-foreground"
          style={{ boxShadow: '0 0 36px hsl(var(--primary) / 0.55)' }}
        >
          <svg viewBox="0 0 52 52" className="size-10" fill="none" aria-hidden>
            <path
              d="M14 27 L23 36 L39 18"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: 48,
                strokeDashoffset: 48,
                animation: 'draw-check 0.5s ease-out 0.35s forwards'
              }}
            />
          </svg>
        </span>
      </div>

      <p className="mt-4 text-base font-medium text-foreground">
        Card accepted
      </p>
      <p className="mt-1 text-sm tabular-nums text-muted-foreground">
        {amountSats.toLocaleString()} sats
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {slow
          ? 'The card accepted this invoice. It can take a moment to arrive.'
          : 'Confirming the payment…'}
      </p>
    </div>
  )
}

export function BoltcardNfcStatus({
  phase,
  detail,
  onEnable,
  onRetry
}: {
  phase: BoltcardNfcPhase
  detail: string | null
  onEnable: () => void
  onRetry: () => void
}) {
  if (phase === 'checking' || phase === 'accepted') return null

  if (phase === 'unsupported') {
    return (
      <p
        className="flex items-center justify-center gap-2 text-center text-xs text-muted-foreground"
        role="status"
      >
        <Nfc className="size-3.5 shrink-0" aria-hidden />
        NFC unavailable on this device. Pay by scanning the QR.
      </p>
    )
  }

  if (phase === 'needs-permission') {
    return (
      <div className="flex flex-col items-center gap-3" role="status">
        <p className="text-center text-xs text-muted-foreground">
          Allow NFC to charge this invoice from a BoltCard.
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onEnable}>
          <Nfc aria-hidden />
          Allow NFC
        </Button>
      </div>
    )
  }

  if (phase === 'scanning') {
    return (
      <div
        className="flex flex-col items-center gap-2"
        role="status"
        aria-live="polite"
      >
        <div className="relative flex size-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
          <span className="absolute inset-2 animate-pulse rounded-full bg-primary/10" />
          <Nfc className="relative size-6 text-primary" aria-hidden />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Hold a BoltCard to the back of the phone
        </p>
      </div>
    )
  }

  if (phase === 'charging') {
    return (
      <div
        className="flex items-center justify-center gap-2 text-sm text-foreground"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <Spinner size={16} />
        Charging the card…
      </div>
    )
  }

  const blocked = phase === 'denied'
  return (
    <div className="flex flex-col items-center gap-3" role="alert">
      <p className="flex items-start justify-center gap-2 text-center text-xs text-destructive">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {detail ??
            (blocked
              ? 'NFC permission was blocked. Allow it in the browser, then try again.'
              : 'Could not charge the card.')}
        </span>
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}
