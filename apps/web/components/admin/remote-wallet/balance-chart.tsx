'use client'

import React, { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import type { NwcTransaction } from '@/lib/client/nwc'

const chartConfig = {
  balance: { label: 'Balance', color: 'oklch(0.78 0.18 162)' /* emerald */ },
} satisfies ChartConfig

interface Point {
  t: number
  balance: number
}

/**
 * Reconstruct balance-over-time from the current balance + settled history.
 * NWC has no balance-history API, so we walk transactions newest→oldest,
 * undoing each one to recover the balance that preceded it. Incoming added
 * `amount`; outgoing removed `amount + fees`. The result is a step series the
 * chart renders left→right in time. (LNCurl's 1 sat/hour drain isn't a
 * transaction, so it's not reflected here — the countdown covers that.)
 */
function buildSeries(txs: NwcTransaction[], currentBalance: number): Point[] {
  const settled = txs
    .filter(t => t.settledAt != null)
    .sort((a, b) => (b.settledAt as number) - (a.settledAt as number))

  let running = currentBalance
  const pts: Point[] = [{ t: Date.now(), balance: currentBalance }]
  for (const tx of settled) {
    // `running` is the balance AFTER this tx (always ≥ 0). Plot it.
    pts.push({ t: tx.settledAt as number, balance: running })
    // Undo the tx to get the balance that preceded it.
    const before =
      tx.type === 'incoming'
        ? running - tx.amountSats
        : running + tx.amountSats + tx.feesPaidSats
    // We only have a recent transaction window, not the wallet's full history.
    // If undoing a tx drives the balance below zero, we've walked past what the
    // window can explain — stop rather than plot impossible negative balances.
    // The series still ends at the real current balance.
    if (before < 0) break
    running = before
  }
  return pts.reverse()
}

function formatCompact(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

export function WalletBalanceChart({
  transactions,
  currentBalanceSats,
}: {
  transactions: NwcTransaction[]
  currentBalanceSats: number | null
}) {
  const data = useMemo(
    () =>
      currentBalanceSats == null ? [] : buildSeries(transactions, currentBalanceSats),
    [transactions, currentBalanceSats],
  )

  if (data.length < 2) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
        Not enough history yet to chart balance.
      </div>
    )
  }

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillBalance" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-balance)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-balance)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="t"
          type="number"
          domain={['dataMin', 'dataMax']}
          scale="time"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={48}
          tickFormatter={t =>
            new Date(t as number).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })
          }
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={44}
          tickFormatter={v => formatCompact(v as number)}
        />
        <Tooltip
          cursor={{ stroke: 'var(--color-balance)', strokeOpacity: 0.3 }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as Point
            return (
              <div className="rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-md">
                <div className="font-medium tabular-nums">
                  {p.balance.toLocaleString()} sats
                </div>
                <div className="text-muted-foreground">
                  {new Date(p.t).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              </div>
            )
          }}
        />
        <Area
          dataKey="balance"
          type="stepAfter"
          stroke="var(--color-balance)"
          strokeWidth={2}
          fill="url(#fillBalance)"
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}
