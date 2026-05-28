'use client'

import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AtSign, Star, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useHover } from './hover-context'
import { useLiveRemoteWalletBalance } from '@/lib/client/hooks/use-remote-wallets'
import { useAnimatedNumber } from '@/lib/client/hooks/use-animated-number'

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
 * edges know which side to attach to. The two edge families flow in
 * OPPOSITE directions to keep both ends of every edge draggable:
 *
 *  - LA edges  flow LA → wallet:   `la:*` SOURCE `out`  → `wallet:*` TARGET `from-la`
 *  - Card edges flow wallet → card: `wallet:*` SOURCE `to-card` → `card:*` TARGET `in`
 *
 *  xyflow only lets the user drag from source handles, so each draggable
 *  endpoint must be the SOURCE of its edge. Flipping the card edges
 *  this way means the wallet's right dot can initiate a connection to a
 *  card — which is what the user actually wants ("attach a card to this
 *  wallet"). The API binding is still `card.remoteWalletId = wallet.id`
 *  regardless of which way the visual arrow points.
 *
 * Connectability — both ends of both edge families are now interactive,
 * so the JSX uses xyflow's defaults (`isConnectable` unset = true).
 */
const NODE_WIDTH = 220

interface LightningAddressNodeData {
  username: string
  domain: string
  mode: string
  /** Mirrors `WalletAddress.isPrimary` — paints the star next to the address. */
  isPrimary: boolean
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
  /** Raw wallet id (without the "wallet:" node-id prefix) for the balance hook. */
  walletId: string
  name: string
  type: string
  status: string
  isDefault: boolean
}

function useDimmed(id: string): boolean {
  const { highlight } = useHover()
  return !!highlight && !highlight.nodes.has(id)
}

/**
 * Live spendable balance + connection-state pill for a Remote Wallet.
 * Split into its own subcomponent because it has its own hooks
 * (polling + odometer) and we want every wallet row to subscribe
 * independently — putting the hooks on `RemoteWalletNode` would force
 * every wallet to share the same effect order, which is fine but
 * separating it keeps the wallet row's render lean.
 *
 * Passes `null` to the balance hook when the wallet isn't live
 * (REVOKED — and DISABLED, optionally) so we don't burn polling
 * requests on rows that have no balance.
 */
function WalletBalanceLine({
  walletId,
  active,
}: {
  walletId: string
  active: boolean
}) {
  // `null` short-circuits the underlying useApi (no fetch, no interval).
  const balance = useLiveRemoteWalletBalance(active ? walletId : null)
  const animated = useAnimatedNumber(balance.data?.balanceSats ?? null)

  if (!active) return null

  const hasValue = balance.data != null
  // Three visual states:
  //   - error    : red, no pulse — the last fetch failed.
  //   - searching: amber, pulsing — we don't have a value yet.
  //   - connected: emerald, no pulse — fresh value in hand.
  const state: 'searching' | 'connected' | 'error' = balance.error
    ? 'error'
    : hasValue
      ? 'connected'
      : 'searching'

  return (
    <span
      className="flex items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground"
      aria-label={`Balance ${state}`}
    >
      <span
        className={cn(
          'inline-block size-1.5 shrink-0 rounded-full',
          state === 'connected' && 'bg-emerald-400',
          state === 'searching' && 'animate-pulse bg-amber-400',
          state === 'error' && 'bg-destructive',
        )}
      />
      {hasValue ? `${animated.toLocaleString()} sats` : '— sats'}
    </span>
  )
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
        <span className="flex items-center gap-1 truncate text-xs font-medium">
          <span className="truncate">
            {d.username}
            <span className="text-muted-foreground">@{d.domain}</span>
          </span>
          {d.isPrimary && (
            <Star
              className="size-3 shrink-0 fill-amber-400 text-amber-400"
              aria-label="Primary"
            />
          )}
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
 * Card node — TARGET handle on the LEFT (the cards column sits on the
 * right of the canvas, so the connection faces the wallets in the
 * middle). Cards are the *receiving* end of the wallet→card binding —
 * the wallet "owns" the card from the graph's perspective, which makes
 * the wallet's right dot the draggable initiator.
 *
 * Layout is a vertical stack: title on top, design image filling the
 * full content width below at credit-card aspect (≈ 8:5). The image is
 * what the admin actually recognises a card by, so it's the dominant
 * visual element rather than a tiny side thumb. When a card has no
 * design image (rare — legacy rows), we fall back to a small secondary
 * text line so the row still has two pieces of information.
 *
 * Because the card row is now taller than LAs / wallets, `buildGraph`
 * uses a separate `cardRowGap` in `NODE_LAYOUT` to lay out the cards
 * column.
 */
export function CardNode({ id, data }: NodeProps) {
  const d = data as unknown as CardNodeData
  const dimmed = useDimmed(id)
  return (
    <div
      className={cn(shellClasses(dimmed), 'items-stretch')}
      style={{ width: NODE_WIDTH }}
    >
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        className="!size-2 !bg-sky-400"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-xs font-medium">{d.label}</span>
        {d.designImage ? (
          // Full-width credit-card-aspect preview. Plain <img> matches
          // the cards table convention (apps/web/app/admin/cards/page.tsx)
          // and avoids next/image's remote-pattern requirement.
          <img
            src={d.designImage}
            alt={d.designName ?? 'Card design'}
            className="aspect-[8/5] w-full rounded-sm border border-border object-cover"
          />
        ) : (
          <span className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
            {d.designName ?? (d.paired ? 'paired' : 'unpaired')}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Remote wallet node — sits in the MIDDLE column with a handle on each
 * side. Both are interactive (defaults), but they belong to opposite
 * edge families:
 *   - `from-la` LEFT  handle is the TARGET of LA→wallet edges. Users
 *                     drag an LA edge's wallet end here to rebind /
 *                     disconnect.
 *   - `to-card` RIGHT handle is the SOURCE of wallet→card edges. Users
 *                     drag from this dot onto a card on the right
 *                     column to bind that card to this wallet.
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
        {/* Live balance line — REVOKED wallets have no balance to fetch. */}
        <WalletBalanceLine walletId={d.walletId} active={d.status !== 'REVOKED'} />
      </div>
      <Handle
        id="to-card"
        type="source"
        position={Position.Right}
        className="!size-2 !bg-sky-400"
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
  /**
   * Vertical stride for LA / wallet rows + header→first-row gap in every
   * column. Cards use a larger stride (see `cardRowGap`) because the
   * full-width design image makes the card node noticeably taller.
   */
  rowGap: 72,
  /**
   * Vertical stride between consecutive card rows in the cards column.
   * Sized for the full-width 8:5 design preview (≈ 124px) + title +
   * padding, with some breathing room so adjacent cards never overlap.
   */
  cardRowGap: 176,
  /** Y of the first header in each column. */
  topY: 0,
}
