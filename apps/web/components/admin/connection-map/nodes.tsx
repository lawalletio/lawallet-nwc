'use client'

import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AtSign, CreditCard, Star, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useHover } from './hover-context'

/**
 * Visual conventions shared by every node in the connection map:
 *  - Fixed width so edges line up cleanly between three columns.
 *  - LAs are the LEFT column; they emit from their RIGHT handle into the
 *    wallet's LEFT-side target handle (`from-la`).
 *  - Cards are the RIGHT column; they emit from their LEFT handle into
 *    the wallet's RIGHT-side target handle (`from-card`).
 *  - Wallets sit in the MIDDLE and expose two target handles, one per
 *    side, so the edges from LAs (coming from the left) and Cards
 *    (coming from the right) meet the node head-on rather than wrapping
 *    around.
 *  - Dimming reads from `HoverContext` instead of node `data` so the
 *    `nodes` array stays stable across hover changes (no flicker).
 *
 * Handle ids — referenced from `buildGraph` in `connection-map.tsx` so
 * edges know which side to attach to:
 *  - LA source: `out`
 *  - Card source: `out`
 *  - Wallet targets: `from-la` (left), `from-card` (right)
 *
 * Connectability:
 *  - LA source + Wallet `from-la` handle are draggable: users can rebind
 *    / connect / disconnect LA→wallet bindings by grabbing the handle.
 *    This is what powers `onConnect`, `onReconnect`, and
 *    `onReconnectEnd` in `connection-map.tsx`.
 *  - Card source is intentionally `isConnectable={false}` — card↔wallet
 *    rebinding lives in a later slice and the PATCH endpoint isn't wired
 *    yet, so we hide the affordance to avoid a half-broken interaction.
 *  - Wallet `from-card` handle is also `isConnectable={false}` for the
 *    same reason; it only renders as a visual attachment point for
 *    existing card edges.
 */
const NODE_WIDTH = 220

interface LightningAddressNodeData {
  username: string
  domain: string
  mode: string
}

interface CardNodeData {
  /** Card "name": the bound LA username if paired, otherwise a truncated id. */
  label: string
  /** Design name (description). Falls back to "paired"/"unpaired" when null. */
  designName: string | null
  /** Design image URL for the thumbnail. Renders the CreditCard icon when null. */
  designImage: string | null
  paired: boolean
}

interface RemoteWalletNodeData {
  name: string
  type: string
  status: string
  isDefault: boolean
}

function useDimmed(id: string): boolean {
  const { highlight } = useHover()
  return !!highlight && !highlight.nodes.has(id)
}

function shellClasses(dimmed: boolean): string {
  return cn(
    'flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm transition-opacity duration-150',
    dimmed && 'opacity-30',
  )
}

/** Lightning Address node — outbound handle on the right (binds to a wallet). */
export function LightningAddressNode({ id, data }: NodeProps) {
  const d = data as unknown as LightningAddressNodeData
  const dimmed = useDimmed(id)
  return (
    <div className={shellClasses(dimmed)} style={{ width: NODE_WIDTH }}>
      <AtSign className="size-4 shrink-0 text-emerald-400" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium">
          {d.username}
          <span className="text-muted-foreground">@{d.domain}</span>
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {d.mode}
        </span>
      </div>
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        className="!size-2 !bg-emerald-400"
      />
    </div>
  )
}

/**
 * Card node — outbound handle on the LEFT (the cards column sits on the
 * right of the canvas, so the connection faces the wallets in the
 * middle). Renders the design thumbnail on the OUTER edge — mirroring
 * the LA node where the icon is also opposite the handle — so the two
 * side columns read as a symmetric pair.
 */
export function CardNode({ id, data }: NodeProps) {
  const d = data as unknown as CardNodeData
  const dimmed = useDimmed(id)
  // Always render a second line so the row height matches the LA node —
  // fall back to pairing status when there's no design description.
  const secondary = d.designName ?? (d.paired ? 'paired' : 'unpaired')
  return (
    <div className={shellClasses(dimmed)} style={{ width: NODE_WIDTH }}>
      <Handle
        id="out"
        type="source"
        position={Position.Left}
        className="!size-2 !bg-sky-400"
        isConnectable={false}
      />
      <div className="flex min-w-0 flex-col flex-1">
        <span className="truncate text-xs font-medium">{d.label}</span>
        <span className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
          {secondary}
        </span>
      </div>
      {d.designImage ? (
        // Plain <img> matches the cards table convention (apps/web/app/
        // admin/cards/page.tsx) and avoids next/image's remote-pattern
        // requirement for a thumb we never need to optimise.
        <img
          src={d.designImage}
          alt={d.designName ?? 'Card design'}
          className="h-8 w-12 shrink-0 rounded-sm border border-border object-cover"
        />
      ) : (
        <CreditCard className="size-4 shrink-0 text-sky-400" />
      )}
    </div>
  )
}

/**
 * Remote wallet node — sits in the MIDDLE column with target handles on
 * BOTH sides so edges from LAs (left) and Cards (right) meet head-on
 * rather than wrapping around the node.
 *   - `from-la`   LEFT  handle, draggable for rebind / disconnect.
 *   - `from-card` RIGHT handle, view-only until cards get a PATCH endpoint.
 */
export function RemoteWalletNode({ id, data }: NodeProps) {
  const d = data as unknown as RemoteWalletNodeData
  const dimmed = useDimmed(id)
  const statusColor =
    d.status === 'ACTIVE'
      ? 'text-amber-400'
      : d.status === 'DISABLED'
        ? 'text-muted-foreground'
        : 'text-destructive'
  return (
    <div className={shellClasses(dimmed)} style={{ width: NODE_WIDTH }}>
      <Handle
        id="from-la"
        type="target"
        position={Position.Left}
        className="!size-2 !bg-amber-400"
      />
      <Wallet className={cn('size-4 shrink-0', statusColor)} />
      <div className="flex min-w-0 flex-col flex-1">
        <span className="flex items-center gap-1 truncate text-xs font-medium">
          {d.name}
          {d.isDefault && (
            <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Primary" />
          )}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {d.type} · {d.status.toLowerCase()}
        </span>
      </div>
      <Handle
        id="from-card"
        type="target"
        position={Position.Right}
        className="!size-2 !bg-sky-400"
        isConnectable={false}
      />
    </div>
  )
}

/** Inline column header rendered as an unselectable, non-draggable node. */
export function ColumnHeaderNode({ data }: NodeProps) {
  const d = data as unknown as { label: string }
  return (
    <div
      className="select-none px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      style={{ width: NODE_WIDTH }}
    >
      {d.label}
    </div>
  )
}

/** Map of node `type` → component, passed to `<ReactFlow nodeTypes={…}>`. */
export const nodeTypes = {
  'lightning-address': LightningAddressNode,
  card: CardNode,
  'remote-wallet': RemoteWalletNode,
  header: ColumnHeaderNode,
}

/**
 * Layout constants for the three-column canvas. x-coords are evenly
 * spaced: NODE_WIDTH (220) per column + 160px gap = 380px stride. Total
 * canvas width is ~ 220*3 + 160*2 = 980px; `fitView` zooms out to fit
 * narrower viewports.
 */
export const NODE_LAYOUT = {
  width: NODE_WIDTH,
  /** Horizontal x of each column, left → right. */
  addressX: 40,
  walletX: 420,
  cardX: 800,
  /** Vertical spacing between consecutive nodes in the same column. */
  rowGap: 72,
  /** Y of the first header in each column. */
  topY: 0,
}
