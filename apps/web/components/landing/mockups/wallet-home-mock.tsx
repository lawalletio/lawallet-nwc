'use client'

import {
  ArrowDownLeft,
  ArrowUpRight,
  Eye,
  QrCode,
  ScanLine,
  Zap,
} from 'lucide-react'

/**
 * Stylised, theme-driven recreation of the mobile wallet home for the landing
 * showcase — NOT the live screen. Mirrors the real layout (balance → actions →
 * address → activity) with every accent reading from `--theme-*`, so it
 * repaints with the community's brand colour.
 */

const ACTIVITY = [
  { dir: 'in' as const, label: 'Received', sub: 'from bob', amount: '+2,100' },
  { dir: 'out' as const, label: 'Sent', sub: 'coffee shop', amount: '-850' },
]

export function WalletHomeMock() {
  return (
    <div className="flex h-full w-full flex-col bg-[#0a0a0f] px-4 pb-4 pt-3 text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <span
          className="flex size-9 items-center justify-center rounded-full text-[11px] font-bold"
          style={{
            background:
              'linear-gradient(135deg, var(--theme-300), color-mix(in srgb, var(--theme-400) 60%, #000))',
            color: '#fff',
          }}
        >
          ay
        </span>
        <span className="flex h-9 flex-1 items-center justify-center rounded-2xl bg-white/[0.04] text-[11px] font-semibold tracking-tight text-foreground">
          lawallet
        </span>
        <span className="flex size-9 items-center justify-center rounded-2xl bg-white/[0.04] text-muted-foreground">
          <Eye className="size-4" />
        </span>
      </div>

      {/* Balance */}
      <div className="flex flex-col items-center gap-2 pb-4 pt-7">
        <span className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/70">
          Your balance
        </span>
        <div className="flex items-baseline gap-1.5">
          <span className="text-4xl font-semibold tabular-nums tracking-tight">
            21,000
          </span>
          <span className="text-sm font-normal text-muted-foreground">sats</span>
        </div>
        <div className="mt-1 flex items-center gap-1 rounded-full bg-white/[0.04] p-0.5">
          <span
            className="rounded-full px-2.5 py-0.5 text-[9px] font-medium text-foreground shadow-sm"
            style={{ background: 'color-mix(in srgb, var(--theme-400) 20%, transparent)' }}
          >
            sats
          </span>
          <span className="rounded-full px-2.5 py-0.5 text-[9px] font-medium text-muted-foreground">
            USD
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2.5">
        <button
          type="button"
          tabIndex={-1}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/[0.06] text-[12px] font-semibold text-foreground"
        >
          <ArrowDownLeft className="size-3.5" />
          Receive
        </button>
        <button
          type="button"
          tabIndex={-1}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl text-[12px] font-semibold text-white"
          style={{
            background:
              'linear-gradient(180deg, var(--theme-400), var(--theme-300))',
            boxShadow:
              '0 8px 20px -8px color-mix(in srgb, var(--theme-400) 70%, transparent)',
          }}
        >
          <ArrowUpRight className="size-3.5" />
          Send
        </button>
      </div>

      {/* Address pill */}
      <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[8px] uppercase tracking-wider text-muted-foreground/70">
            Address
          </span>
          <span className="flex items-center gap-1 truncate text-[12px] font-semibold">
            <Zap className="size-3" style={{ color: 'var(--theme-400)' }} />
            satoshi@lawallet.io
          </span>
        </div>
        <span className="flex size-7 items-center justify-center rounded-lg bg-white/[0.05] text-muted-foreground">
          <QrCode className="size-3.5" />
        </span>
      </div>

      {/* Activity */}
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-foreground">Activity</span>
        <span className="text-[9px] text-muted-foreground/70">View all</span>
      </div>
      <div className="mt-2 flex flex-col gap-px overflow-hidden rounded-xl bg-white/[0.03]">
        {ACTIVITY.map((tx, i) => {
          const incoming = tx.dir === 'in'
          return (
            <div
              key={i}
              className="flex items-center gap-2.5 border-b border-white/[0.04] px-3 py-2 last:border-b-0"
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full"
                style={
                  incoming
                    ? {
                        background:
                          'color-mix(in srgb, var(--theme-400) 16%, transparent)',
                        color: 'var(--theme-400)',
                      }
                    : { background: 'rgba(255,255,255,0.05)', color: '#a3a3a3' }
                }
              >
                {incoming ? (
                  <ArrowDownLeft className="size-3.5" />
                ) : (
                  <ArrowUpRight className="size-3.5" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="text-[11px] font-medium text-foreground">
                  {tx.label}
                </span>
                <span className="truncate text-[8px] text-muted-foreground/70">
                  {tx.sub}
                </span>
              </span>
              <span
                className="font-mono text-[11px] font-semibold tabular-nums"
                style={{ color: incoming ? 'var(--theme-400)' : '#d4d4d4' }}
              >
                {tx.amount}
              </span>
            </div>
          )
        })}
      </div>

      {/* Floating scan tab hint */}
      <div className="mt-auto flex justify-center pt-4">
        <span
          className="flex size-10 items-center justify-center rounded-full text-white shadow-lg"
          style={{
            background:
              'linear-gradient(180deg, var(--theme-400), var(--theme-300))',
            boxShadow:
              '0 10px 24px -8px color-mix(in srgb, var(--theme-400) 70%, transparent)',
          }}
        >
          <ScanLine className="size-5" />
        </span>
      </div>
    </div>
  )
}
