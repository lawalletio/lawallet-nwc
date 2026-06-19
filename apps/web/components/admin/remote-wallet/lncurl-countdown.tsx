'use client'

import React, { useEffect, useState } from 'react'
import { Hourglass, Skull } from 'lucide-react'
import { cn } from '@/lib/utils'

const HOUR_MS = 3_600_000

/**
 * Realtime "time to destruction" countdown for a disposable LNCurl wallet.
 *
 * LNCurl charges 1 sat/hour, so a wallet holding `balanceSats` survives roughly
 * `balanceSats` hours. We fix the destruction target whenever the live balance
 * changes, then tick a 1-second clock down to it — so the seconds visibly move
 * even though the underlying balance only refreshes on a poll.
 */
export function LncurlCountdown({ balanceSats }: { balanceSats: number | null }) {
  // Destruction timestamp — pinned when the balance changes (not every tick,
  // or it would never count down).
  const [target, setTarget] = useState<number | null>(null)
  // `null` until mounted so SSR and the first client render agree (no Date.now
  // during render → no hydration mismatch).
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    if (balanceSats == null) {
      setTarget(null)
      return
    }
    setTarget(Date.now() + balanceSats * HOUR_MS)
  }, [balanceSats])

  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (balanceSats == null || target == null || now == null) {
    return <CountdownShell parts={null} dying={false} />
  }

  const remainingMs = Math.max(0, target - now)
  if (remainingMs <= 0) {
    return <CountdownShell parts={null} dying />
  }

  const totalSeconds = Math.floor(remainingMs / 1000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  // "Urgent" once under an hour of runway — flip the accent to destructive.
  const urgent = remainingMs < HOUR_MS

  return (
    <CountdownShell
      dying={false}
      urgent={urgent}
      parts={[
        { label: 'days', value: days },
        { label: 'hrs', value: hours },
        { label: 'min', value: minutes },
        { label: 'sec', value: seconds },
      ]}
    />
  )
}

function CountdownShell({
  parts,
  dying,
  urgent = false,
}: {
  parts: { label: string; value: number }[] | null
  dying: boolean
  urgent?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        dying
          ? 'border-destructive/40 bg-destructive/5'
          : urgent
            ? 'border-destructive/40 bg-destructive/5'
            : 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 text-xs font-medium',
          dying || urgent ? 'text-destructive' : 'text-amber-600 dark:text-amber-400',
        )}
      >
        {dying ? <Skull className="size-3.5" /> : <Hourglass className="size-3.5" />}
        {dying ? 'Out of sats — destroyed' : 'Self-destructs in'}
      </div>
      {parts && (
        <div className="grid grid-cols-4 gap-2">
          {parts.map(p => (
            <div
              key={p.label}
              className="flex flex-col items-center rounded-md bg-background/60 py-2"
            >
              <span className="text-xl font-semibold tabular-nums leading-none">
                {String(p.value).padStart(2, '0')}
              </span>
              <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {p.label}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Costs 1 sat/hour. Top up or move funds out before it hits 0 — it can&apos;t
        be recovered once destroyed.
      </p>
    </div>
  )
}
