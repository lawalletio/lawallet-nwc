'use client'

import React, { useCallback, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
// Co-located admin theme overrides for the Controls panel — imported AFTER
// the xyflow stylesheet so source-order wins on equal specificity.
import './connection-map.css'
import { toast } from 'sonner'
import { useRemoteWallets, type RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import {
  useMyAddresses,
  useAddressMutations,
  type WalletAddress,
} from '@/lib/client/hooks/use-wallet-addresses'
import { useCards, type CardData } from '@/lib/client/hooks/use-cards'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { Spinner } from '@/components/ui/spinner'
import { truncateHex } from '@/lib/client/format'
import { nodeTypes, NODE_LAYOUT } from './nodes'
import { HoverProvider, type HighlightSet } from './hover-context'
import { HighlightEdge } from './highlight-edge'

/** Stable id helpers — used by both nodes and edges so they always agree. */
const walletNodeId = (id: string) => `wallet:${id}`
const addressNodeId = (username: string) => `la:${username}`
const cardNodeId = (id: string) => `card:${id}`

/** Inverse helpers — extract the model id from a node id, or null if the prefix doesn't match. */
const usernameFromNodeId = (nodeId: string | null | undefined): string | null =>
  nodeId && nodeId.startsWith('la:') ? nodeId.slice('la:'.length) : null
const walletIdFromNodeId = (nodeId: string | null | undefined): string | null =>
  nodeId && nodeId.startsWith('wallet:') ? nodeId.slice('wallet:'.length) : null

/**
 * Edge type registry. Defined at module scope so React Flow sees a stable
 * identity across renders (a fresh object literal each render would trigger
 * the "new nodeTypes / edgeTypes object" warning + extra work).
 */
const edgeTypes = { highlight: HighlightEdge }

/**
 * Three-column connection map: Lightning Addresses on the LEFT, Remote
 * Wallets in the MIDDLE, Cards on the RIGHT. Bezier edges connect the
 * outer columns to the wallets in the middle, so the graph reads as
 * "what LA / card binds to which wallet" at a glance without crossing
 * lanes.
 *
 * Interactions today (slice 1 + drag-to-rebind for LAs):
 *   - Hover a node/edge: dim everything else.
 *   - Drag from an LA handle to a wallet handle: bind (CUSTOM_NWC).
 *   - Drag the wallet end of an LA edge to a different wallet: rebind.
 *   - Drag the wallet end of an LA edge into empty space: disconnect → IDLE.
 *
 * Card↔Wallet rebinding ships in a follow-up commit (the card PATCH
 * endpoint isn't there yet); the card source handle is inert today.
 *
 * Positions are deterministic (no auto-layout) so the canvas stays stable
 * across re-renders / SSE refreshes — each row computes its y from its
 * index in the source list.
 *
 * Why hover lives in a Context instead of inside the `nodes`/`edges`
 * arrays:
 *   Folding hover state into the arrays gave every node/edge object a new
 *   identity on every mouseEnter/Leave, so React Flow reconciled the
 *   whole graph, the cursor lost its hover target mid-frame, mouseLeave
 *   fired, mouseEnter fired again, and the screen flickered while the
 *   cursor toggled between pointer/arrow. With a Context, only the
 *   individual node/edge components re-render on hover — the arrays
 *   handed to React Flow stay reference-stable across mouse moves.
 *
 *   `isPanning` further silences the hover handlers while the user is
 *   dragging the canvas, since elements sliding under the cursor would
 *   otherwise fire a constant stream of enter/leave events.
 */
function ConnectionMapInner() {
  const { data: settings } = useSettings()
  const { data: wallets, loading: walletsLoading } = useRemoteWallets()
  const { data: addresses, loading: addressesLoading } = useMyAddresses()
  // /api/cards is admin-scoped. For non-admin callers we just render no
  // card group; a per-user cards endpoint would let non-admins see their
  // own cards bound to wallets (out of scope for this slice).
  const { data: cards, loading: cardsLoading } = useCards()

  const loading = walletsLoading || addressesLoading || cardsLoading
  const domain = settings?.domain || 'your-domain'

  // Hover lives in local state, NOT folded into the nodes/edges arrays.
  // Hovering a node highlights its edges + the nodes on the other end;
  // hovering an edge highlights its two endpoints. The HoverProvider
  // exposes the resulting set to the node + edge components, which render
  // their own dim state — so the arrays handed to ReactFlow stay stable.
  const [hovered, setHovered] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null)

  // While the user is panning the canvas OR dragging a handle to create /
  // reconnect an edge, suppress hover updates. Without these gates, every
  // element passing under the cursor fires mouseEnter/Leave, which churns
  // the highlight set and visually competes with the drag.
  const [isPanning, setIsPanning] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)

  // `onReconnect` and `onReconnectEnd` cooperate via this ref to detect
  // "edge dragged off into empty space" (the official xyflow pattern, see
  // https://reactflow.dev/learn/advanced-use/delete-edges-on-drop). The
  // ref starts at true so a fresh drag that never lands anywhere ends up
  // calling the disconnect path.
  const edgeReconnectSuccessful = useRef(true)

  const { updateAddress } = useAddressMutations()

  /** Default wallet drives the "implicit binding" for DEFAULT_NWC addresses. */
  const defaultWallet = useMemo(
    () => wallets?.find(w => w.isDefault) ?? null,
    [wallets],
  )

  const { nodes, edges } = useMemo(
    () => buildGraph({ wallets, addresses, cards, defaultWallet, domain }),
    [wallets, addresses, cards, defaultWallet, domain],
  )

  // Compute the highlight set. When nothing is hovered, everything renders
  // at full opacity (no dimming).
  const highlight = useMemo(
    () => computeHighlight(hovered, edges),
    [hovered, edges],
  )

  // Memoise the context value so consumers only re-render when `highlight`
  // actually changes — not on every render of this component (e.g. while
  // `isPanning` flips during a drag).
  const hoverValue = useMemo(() => ({ highlight }), [highlight])

  // ── Lightning Address ↔ Wallet rebinding ─────────────────────────────────
  // Only LA edges are interactive here. Card edges are inert (their handle
  // is `isConnectable={false}` in nodes.tsx). The shape of an LA edge id is
  // `e:la:<username>-><walletId>` (CUSTOM_NWC) or
  // `e:la:<username>->default:<defaultWalletId>` (DEFAULT_NWC), but we don't
  // parse the edge id — we derive `username` from `edge.source` and the
  // wallet from `edge.target` (or `newConnection.target` on reconnect),
  // which is the same data Prisma sees.
  //
  // Three flows, all backed by the same `PUT /api/wallet/addresses/:username`
  // endpoint, which emits `addresses:updated` over SSE so the underlying
  // `useMyAddresses` (and thus `nodes`/`edges`) refresh automatically:
  //   - CONNECT     : LA had no edge → drag from LA handle to a wallet handle
  //                   → `mode: CUSTOM_NWC, remoteWalletId: <walletId>`.
  //   - REBIND      : LA already had an edge → drag the wallet-side endpoint
  //                   to a different wallet → same CUSTOM_NWC payload, new id.
  //   - DISCONNECT  : LA already had an edge → drag the wallet-side endpoint
  //                   into empty space → `mode: IDLE` (wipes redirect +
  //                   remoteWalletId server-side).
  //
  // Optimistic UI is deliberately skipped — the round-trip is fast and the
  // SSE refresh keeps the source of truth on the server, which avoids the
  // "edge briefly snaps to two places" flicker we'd see if we mutated the
  // local nodes/edges array and then re-derived from a new fetch.

  const bindAddressToWallet = useCallback(
    async (username: string, walletId: string) => {
      try {
        await updateAddress(username, { mode: 'CUSTOM_NWC', remoteWalletId: walletId })
        toast.success(`${username} bound to wallet`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not bind address'
        toast.error(msg)
      }
    },
    [updateAddress],
  )

  const disconnectAddress = useCallback(
    async (username: string) => {
      try {
        await updateAddress(username, { mode: 'IDLE' })
        toast.success(`${username} disconnected`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not disconnect address'
        toast.error(msg)
      }
    },
    [updateAddress],
  )

  const handleConnectStart = useCallback(() => setIsConnecting(true), [])
  const handleConnectEnd = useCallback(() => setIsConnecting(false), [])

  // New edge created by dragging from a source handle onto a target handle.
  // Source-side guard: only LA → Wallet is allowed (Card handles are not
  // connectable, but be defensive against future changes).
  const handleConnect = useCallback(
    (connection: Connection) => {
      const username = usernameFromNodeId(connection.source)
      const walletId = walletIdFromNodeId(connection.target)
      if (username && walletId) bindAddressToWallet(username, walletId)
    },
    [bindAddressToWallet],
  )

  const handleReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false
    setIsConnecting(true)
  }, [])

  // Existing LA edge dragged onto a new wallet handle. We update via the
  // edge's `source` (the LA), not the old/new wallet — the LA is the row
  // we're patching, regardless of which wallet it lands on.
  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      edgeReconnectSuccessful.current = true
      const username = usernameFromNodeId(oldEdge.source)
      const walletId = walletIdFromNodeId(newConnection.target)
      if (username && walletId) bindAddressToWallet(username, walletId)
    },
    [bindAddressToWallet],
  )

  // Edge dropped on empty space: disconnect. The ref pattern means we land
  // here only when `handleReconnect` did NOT run for the same drag.
  const handleReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: Edge) => {
      setIsConnecting(false)
      if (edgeReconnectSuccessful.current) {
        edgeReconnectSuccessful.current = true
        return
      }
      edgeReconnectSuccessful.current = true
      const username = usernameFromNodeId(edge.source)
      if (username) disconnectAddress(username)
    },
    [disconnectAddress],
  )

  // Reject invalid drops while the user is dragging — xyflow paints the
  // ghost edge red so the affordance reads as "this won't work" before
  // the release. Two rules:
  //   1. Only LA → wallet connections are allowed (Card source handles
  //      are non-connectable, but be defensive).
  //   2. The LA edge must land on the wallet's LEFT (`from-la`) handle —
  //      the right (`from-card`) side is reserved for cards.
  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source?.startsWith('la:')) return false
    if (!connection.target?.startsWith('wallet:')) return false
    if (connection.targetHandle && connection.targetHandle !== 'from-la') return false
    return true
  }, [])

  if (loading && !nodes.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={24} className="text-muted-foreground" />
      </div>
    )
  }

  return (
    <HoverProvider value={hoverValue}>
      <div className="h-full">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          // The admin shell is `forcedTheme="dark"` via next-themes, so we
          // hardcode dark here too. This flips xyflow's internal CSS vars
          // (background, edge default colors, MiniMap, etc.) to dark-mode
          // values. Our `connection-map.css` further tunes the Controls
          // panel to match the admin palette.
          colorMode="dark"
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          // Layout stays fixed (positions are deterministic) but handles
          // are interactive so users can connect / rebind / disconnect LA
          // edges. Card handles opt out via `isConnectable={false}` in
          // nodes.tsx.
          nodesDraggable={false}
          nodesConnectable
          edgesFocusable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          // Style the in-flight connection line to match LA edges (emerald,
          // dashed while dragging) so the affordance is obvious.
          connectionLineStyle={{
            stroke: 'oklch(0.78 0.18 162)',
            strokeWidth: 1.5,
            strokeDasharray: '4 4',
          }}
          isValidConnection={isValidConnection}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onReconnect={handleReconnect}
          onReconnectStart={handleReconnectStart}
          onReconnectEnd={handleReconnectEnd}
          onMoveStart={() => setIsPanning(true)}
          onMoveEnd={() => setIsPanning(false)}
          onNodeMouseEnter={(_, n) => {
            if (!isPanning && !isConnecting) setHovered({ kind: 'node', id: n.id })
          }}
          onNodeMouseLeave={() => {
            if (!isPanning && !isConnecting) setHovered(null)
          }}
          onEdgeMouseEnter={(_, e) => {
            if (!isPanning && !isConnecting) setHovered({ kind: 'edge', id: e.id })
          }}
          onEdgeMouseLeave={() => {
            if (!isPanning && !isConnecting) setHovered(null)
          }}
        >
          <Background gap={24} size={1} className="!bg-background" />
          <Controls position="bottom-right" showInteractive={false} />
          {nodes.length === 0 && !loading && (
            <Panel position="top-center">
              <p className="text-sm text-muted-foreground">
                Nothing to show yet — add a wallet, address, or card.
              </p>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </HoverProvider>
  )
}

/** Public wrapper — `ReactFlowProvider` is required for internal hooks. */
export function ConnectionMap() {
  return (
    <ReactFlowProvider>
      <ConnectionMapInner />
    </ReactFlowProvider>
  )
}

// ── Graph construction ──────────────────────────────────────────────────────

interface BuildGraphInput {
  wallets: RemoteWalletData[] | null
  addresses: WalletAddress[] | null
  cards: CardData[] | null
  defaultWallet: RemoteWalletData | null
  domain: string
}

interface BuiltGraph {
  nodes: Node[]
  edges: Edge[]
}

/**
 * Deterministic positions, one column per model:
 *   - LEFT   (`addressX`): Lightning Addresses header + LA nodes.
 *   - MIDDLE (`walletX`) : Remote Wallets header + wallet nodes.
 *   - RIGHT  (`cardX`)   : Cards header + card nodes.
 * Each column stacks from `topY` downward by `rowGap`, so the y of any
 * row is purely a function of its index in its source list — no
 * auto-layout, stable across re-renders.
 *
 * Edge handle ids must match `nodes.tsx`:
 *   - LA   `out` (right) → Wallet `from-la`   (left)
 *   - Card `out` (left)  → Wallet `from-card` (right)
 */
function buildGraph({
  wallets,
  addresses,
  cards,
  defaultWallet,
  domain,
}: BuildGraphInput): BuiltGraph {
  const { addressX, walletX, cardX, rowGap, topY } = NODE_LAYOUT
  const nodes: Node[] = []
  const edges: Edge[] = []

  // ── Column 1 (left): Lightning Addresses ────────────────────────────────
  let y = topY
  if (addresses && addresses.length > 0) {
    nodes.push({
      id: 'header:addresses',
      type: 'header',
      position: { x: addressX, y },
      data: { label: 'Lightning Addresses' },
      draggable: false,
      selectable: false,
    })
    y += rowGap
    for (const addr of addresses) {
      nodes.push({
        id: addressNodeId(addr.username),
        type: 'lightning-address',
        position: { x: addressX, y },
        data: { username: addr.username, domain, mode: addr.mode },
      })
      y += rowGap
    }
  }

  // ── Column 2 (middle): Remote Wallets ───────────────────────────────────
  y = topY
  if (wallets && wallets.length > 0) {
    nodes.push({
      id: 'header:wallets',
      type: 'header',
      position: { x: walletX, y },
      data: { label: 'Remote Wallets' },
      draggable: false,
      selectable: false,
    })
    y += rowGap
    for (const w of wallets) {
      nodes.push({
        id: walletNodeId(w.id),
        type: 'remote-wallet',
        position: { x: walletX, y },
        data: { name: w.name, type: w.type, status: w.status, isDefault: w.isDefault },
      })
      y += rowGap
    }
  }

  // ── Column 3 (right): Cards ─────────────────────────────────────────────
  // Card "label" prefers the bound LA username (most recognisable), then
  // falls back to a `first8...last8` truncation of the card id so even
  // unpaired cards have a stable, distinguishable handle.
  y = topY
  if (cards && cards.length > 0) {
    nodes.push({
      id: 'header:cards',
      type: 'header',
      position: { x: cardX, y },
      data: { label: 'Cards' },
      draggable: false,
      selectable: false,
    })
    y += rowGap
    for (const card of cards) {
      nodes.push({
        id: cardNodeId(card.id),
        type: 'card',
        position: { x: cardX, y },
        data: {
          label: card.lightningAddress?.username ?? truncateHex(card.id),
          designName: card.design?.description ?? null,
          designImage: card.design?.image ?? null,
          paired: !!card.ntag424,
        },
      })
      y += rowGap
    }
  }

  // ── Edges ───────────────────────────────────────────────────────────────
  // All edges use the 'highlight' custom edge type so they can read the
  // current hover from HoverContext and dim themselves locally — no
  // rebuilding of the edges array required.
  //
  // `reconnectable` per-edge:
  //   - LA edges: 'target' — drag the wallet end to rebind or to empty
  //     space to disconnect. The LA end is fixed; dragging it onto
  //     another LA doesn't make sense.
  //   - Card edges: false — card↔wallet rebinding ships in a later slice.
  //
  // Address bindings:
  //   CUSTOM_NWC   → solid edge to the address's bound wallet.
  //   DEFAULT_NWC  → dashed edge to the user's default wallet (implicit).
  //   IDLE / ALIAS → no edge (no wallet involved).
  for (const addr of addresses ?? []) {
    if (addr.mode === 'CUSTOM_NWC' && addr.remoteWalletId) {
      edges.push({
        id: `e:la:${addr.username}->${addr.remoteWalletId}`,
        type: 'highlight',
        source: addressNodeId(addr.username),
        sourceHandle: 'out',
        target: walletNodeId(addr.remoteWalletId),
        targetHandle: 'from-la',
        reconnectable: 'target',
        style: { stroke: 'oklch(0.78 0.18 162)' /* emerald */, strokeWidth: 1.5 },
      })
    } else if (addr.mode === 'DEFAULT_NWC' && defaultWallet) {
      edges.push({
        id: `e:la:${addr.username}->default:${defaultWallet.id}`,
        type: 'highlight',
        source: addressNodeId(addr.username),
        sourceHandle: 'out',
        target: walletNodeId(defaultWallet.id),
        targetHandle: 'from-la',
        reconnectable: 'target',
        style: {
          stroke: 'oklch(0.78 0.18 162)',
          strokeWidth: 1.5,
          strokeDasharray: '4 4',
        },
      })
    }
  }

  // Card bindings enter the wallet from the RIGHT (`from-card`) so the
  // bezier curves out from the card column on the right cleanly.
  for (const card of cards ?? []) {
    if (!card.remoteWalletId) continue
    edges.push({
      id: `e:card:${card.id}->${card.remoteWalletId}`,
      type: 'highlight',
      source: cardNodeId(card.id),
      sourceHandle: 'out',
      target: walletNodeId(card.remoteWalletId),
      targetHandle: 'from-card',
      reconnectable: false,
      style: { stroke: 'oklch(0.72 0.16 245)' /* sky */, strokeWidth: 1.5 },
    })
  }

  return { nodes, edges }
}

// ── Hover highlighting ────────────────────────────────────────────────────

function computeHighlight(
  hovered: { kind: 'node' | 'edge'; id: string } | null,
  edges: Edge[],
): HighlightSet | null {
  if (!hovered) return null

  const keptNodes = new Set<string>()
  const keptEdges = new Set<string>()

  if (hovered.kind === 'node') {
    keptNodes.add(hovered.id)
    for (const e of edges) {
      if (e.source === hovered.id || e.target === hovered.id) {
        keptEdges.add(e.id)
        keptNodes.add(e.source)
        keptNodes.add(e.target)
      }
    }
  } else {
    const e = edges.find(edge => edge.id === hovered.id)
    if (e) {
      keptEdges.add(e.id)
      keptNodes.add(e.source)
      keptNodes.add(e.target)
    }
  }

  return { nodes: keptNodes, edges: keptEdges }
}
