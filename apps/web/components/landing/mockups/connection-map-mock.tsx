'use client'

import { AtSign, CreditCard, Star, Wallet } from 'lucide-react'

/**
 * Stylised, theme-driven recreation of the admin Connection Map for the
 * landing showcase — NOT the live canvas. Three columns (Lightning Addresses →
 * Remote Wallets → NFC Cards) wired together with animated energy edges. Every
 * accent reads from `--theme-*`, so it repaints with the community's brand
 * colour. Coordinates live in a 0–100 space; the edge <svg> stretches to fill
 * (preserveAspectRatio="none") with non-scaling strokes so lines stay crisp.
 */

type Pt = { x: number; y: number }

const LAS: Array<Pt & { name: string; primary?: boolean }> = [
  { x: 15, y: 24, name: 'alice', primary: true },
  { x: 15, y: 50, name: 'bob' },
  { x: 15, y: 76, name: 'carol' },
]

const WALLETS: Array<Pt & { name: string; sats: string; kind: string }> = [
  { x: 50, y: 35, name: 'Community NWC', sats: '128,400', kind: 'NWC' },
  { x: 50, y: 71, name: 'LNCurl', sats: '2,100', kind: 'LNCurl' },
]

const CARDS: Array<Pt & { name: string }> = [
  { x: 85, y: 18, name: 'Card 01' },
  { x: 85, y: 45, name: 'Card 02' },
  { x: 85, y: 74, name: 'Card 03' },
]

// LA → wallet, then wallet → card. Indices into the arrays above.
const LA_EDGES: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [2, 1],
]
const CARD_EDGES: Array<[number, number]> = [
  [0, 0],
  [0, 1],
  [1, 2],
]

function edgePath(a: Pt, b: Pt): string {
  const dx = (b.x - a.x) * 0.5
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`
}

function ColumnLabel({ left, children }: { left: number; children: string }) {
  return (
    <span
      className="absolute top-[3%] -translate-x-1/2 whitespace-nowrap text-[9px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60"
      style={{ left: `${left}%` }}
    >
      {children}
    </span>
  )
}

export function ConnectionMapMock() {
  const allEdges = [
    ...LA_EDGES.map(([la, w], i) => ({
      id: `la-${i}`,
      d: edgePath(LAS[la], WALLETS[w]),
      delay: i * 0.6,
    })),
    ...CARD_EDGES.map(([w, c], i) => ({
      id: `card-${i}`,
      d: edgePath(WALLETS[w], CARDS[c]),
      delay: 0.3 + i * 0.6,
    })),
  ]

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0a0a0f]">
      {/* Atmosphere: theme glow + faint dot grid */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 50% 45%, color-mix(in srgb, var(--theme-400) 14%, transparent), transparent 70%)',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            'radial-gradient(color-mix(in srgb, var(--theme-400) 16%, transparent) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />

      <ColumnLabel left={15}>Lightning Addresses</ColumnLabel>
      <ColumnLabel left={50}>Remote Wallets</ColumnLabel>
      <ColumnLabel left={85}>NFC Cards</ColumnLabel>

      {/* Edges */}
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="cm-edge" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--theme-300)" stopOpacity="0.15" />
            <stop offset="50%" stopColor="var(--theme-400)" stopOpacity="0.9" />
            <stop offset="100%" stopColor="var(--theme-300)" stopOpacity="0.15" />
          </linearGradient>
        </defs>
        {allEdges.map(e => (
          <g key={e.id}>
            {/* soft base line */}
            <path
              d={e.d}
              fill="none"
              stroke="color-mix(in srgb, var(--theme-400) 22%, transparent)"
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
            {/* flowing energy dash */}
            <path
              d={e.d}
              fill="none"
              stroke="url(#cm-edge)"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeDasharray="14 110"
              vectorEffect="non-scaling-stroke"
              className="cm-flow"
              style={{ animationDelay: `${e.delay}s` }}
            />
          </g>
        ))}
      </svg>

      {/* Lightning address nodes */}
      {LAS.map(la => (
        <NodeShell key={la.name} x={la.x} y={la.y}>
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-md"
            style={{
              background: 'color-mix(in srgb, var(--theme-400) 16%, transparent)',
              color: 'var(--theme-400)',
            }}
          >
            <AtSign className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="flex items-center gap-1 font-mono text-[11px] font-semibold text-foreground">
              {la.name}
              {la.primary && (
                <Star
                  className="size-2.5"
                  style={{ color: 'var(--theme-400)', fill: 'var(--theme-400)' }}
                />
              )}
            </span>
            <span className="truncate text-[8px] text-muted-foreground/70">
              @lawallet.io
            </span>
          </span>
        </NodeShell>
      ))}

      {/* Remote wallet nodes (slightly wider) */}
      {WALLETS.map(w => (
        <NodeShell key={w.name} x={w.x} y={w.y} accent wide>
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-md"
            style={{
              background: 'color-mix(in srgb, var(--theme-400) 22%, transparent)',
              color: 'var(--theme-400)',
            }}
          >
            <Wallet className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-[11px] font-semibold text-foreground">
              {w.name}
            </span>
            <span className="font-mono text-[8px] text-muted-foreground/80">
              {w.sats} sats
            </span>
          </span>
        </NodeShell>
      ))}

      {/* NFC card nodes */}
      {CARDS.map(c => (
        <NodeShell key={c.name} x={c.x} y={c.y}>
          <span
            className="flex h-7 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[5px] border border-white/10"
            style={{
              background:
                'linear-gradient(135deg, var(--theme-300), color-mix(in srgb, var(--theme-400) 70%, #000))',
            }}
          >
            <CreditCard className="size-3 text-white/90" />
          </span>
          <span className="truncate text-[11px] font-medium text-foreground">
            {c.name}
          </span>
        </NodeShell>
      ))}

      <style jsx>{`
        @keyframes cm-flow {
          to {
            stroke-dashoffset: -124;
          }
        }
        .cm-flow {
          animation: cm-flow 2.4s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .cm-flow {
            animation: none;
          }
        }
      `}</style>
    </div>
  )
}

function NodeShell({
  x,
  y,
  accent,
  wide,
  children,
}: {
  x: number
  y: number
  accent?: boolean
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg border bg-[#101018]/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: wide ? 170 : 132,
        borderColor: accent
          ? 'color-mix(in srgb, var(--theme-400) 45%, transparent)'
          : 'rgba(255,255,255,0.08)',
        boxShadow: accent
          ? '0 8px 24px -8px color-mix(in srgb, var(--theme-400) 40%, transparent)'
          : '0 8px 20px -10px rgba(0,0,0,0.7)',
      }}
    >
      {children}
    </div>
  )
}
