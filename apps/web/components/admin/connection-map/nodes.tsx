'use client'

import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AtSign, CreditCard, Star, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useHover } from './hover-context'

/**
 * Visual conventions shared by every node in the connection map:
 *  - Fixed width so edges line up cleanly between two columns.
 *  - Left column (LAs, Cards) emits edges from the RIGHT handle → wallet.
 *  - Right column (wallets) receives edges on the LEFT handle.
 *  - Dimming reads from `HoverContext` instead of node `data` so the
 *    `nodes` array stays stable across hover changes (no flicker).
 */
const NODE_WIDTH = 220

interface LightningAddressNodeData {
  username: string
  domain: string
  mode: string
}

interface CardNodeData {
  label: string
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
      <Handle type="source" position={Position.Right} className="!size-2 !bg-emerald-400" />
    </div>
  )
}

/** Card node — outbound handle on the right (spends from a wallet). */
export function CardNode({ id, data }: NodeProps) {
  const d = data as unknown as CardNodeData
  const dimmed = useDimmed(id)
  return (
    <div className={shellClasses(dimmed)} style={{ width: NODE_WIDTH }}>
      <CreditCard className="size-4 shrink-0 text-sky-400" />
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium">{d.label}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {d.paired ? 'paired' : 'unpaired'}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!size-2 !bg-sky-400" />
    </div>
  )
}

/** Remote wallet node — inbound handle on the left (receives LA / card edges). */
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
      <Handle type="target" position={Position.Left} className="!size-2 !bg-amber-400" />
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

export const NODE_LAYOUT = {
  width: NODE_WIDTH,
  /** Horizontal x of each column. */
  leftX: 40,
  rightX: 420,
  /** Vertical spacing between consecutive nodes in the same column. */
  rowGap: 72,
  /** Gap between the LA group and the Cards group on the left column. */
  groupGap: 48,
  /** Y of the first header in each column. */
  topY: 0,
}
