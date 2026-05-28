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
 * Two-column connection map: Lightning Addresses + Cards on the left,
 * Remote Wallets on the right, bezier edges for every active binding.
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
 * Deterministic positions: each section (LA header → LAs → Cards header →
 * Cards) is stacked vertically in the left column; wallets stack in the
 * right column. Header rows take one row each.
 */
function buildGraph({
  wallets,
  addresses,
  cards,
  defaultWallet,
  domain,
}: BuildGraphInput): BuiltGraph {
  const { leftX, rightX, rowGap, groupGap, topY } = NODE_LAYOUT
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Left column: addresses on top, then cards.
  let leftY = topY
  if (addresses && addresses.length > 0) {
    nodes.push({
      id: 'header:addresses',
      type: 'header',
      position: { x: leftX, y: leftY },
      data: { label: 'Lightning Addresses' },
      draggable: false,
      selectable: false,
    })
    leftY += rowGap
    for (const addr of addresses) {
      nodes.push({
        id: addressNodeId(addr.username),
        type: 'lightning-address',
        position: { x: leftX, y: leftY },
        data: { username: addr.username, domain, mode: addr.mode },
      })
      leftY += rowGap
    }
    leftY += groupGap - rowGap
  }
  if (cards && cards.length > 0) {
    nodes.push({
      id: 'header:cards',
      type: 'header',
      position: { x: leftX, y: leftY },
      data: { label: 'Cards' },
      draggable: false,
      selectable: false,
    })
    leftY += rowGap
    for (const card of cards) {
      nodes.push({
        id: cardNodeId(card.id),
        type: 'card',
        position: { x: leftX, y: leftY },
        data: {
          label: card.lightningAddress?.username ?? card.id.slice(0, 8),
          paired: !!card.ntag424,
        },
      })
      leftY += rowGap
    }
  }

  // Right column: wallets. Reserve a header row for parity with the left.
  let rightY = topY
  if (wallets && wallets.length > 0) {
    nodes.push({
      id: 'header:wallets',
      type: 'header',
      position: { x: rightX, y: rightY },
      data: { label: 'Remote Wallets' },
      draggable: false,
      selectable: false,
    })
    rightY += rowGap
    for (const w of wallets) {
      nodes.push({
        id: walletNodeId(w.id),
        type: 'remote-wallet',
        position: { x: rightX, y: rightY },
        data: { name: w.name, type: w.type, status: w.status, isDefault: w.isDefault },
      })
      rightY += rowGap
    }
  }

  // ── Edges ───────────────────────────────────────────────────────────────
  // All edges use the 'highlight' custom edge type so they can read the
  // current hover from HoverContext and dim themselves locally — no
  // rebuilding of the edges array required.
  //
  // `reconnectable` is set per-edge:
  //   - LA edges: 'target' — users can drag the wallet end to rebind or to
  //     empty space to disconnect, but the LA end stays put (dragging it
  //     onto another LA doesn't make sense).
  //   - Card edges: false — card↔wallet rebinding ships in a later slice.
  //
  // Address bindings:
  //   CUSTOM_NWC  → solid edge to the address's bound wallet.
  //   DEFAULT_NWC → dashed edge to the user's default wallet (implicit).
  //   IDLE / ALIAS → no edge (no wallet involved).
  for (const addr of addresses ?? []) {
    if (addr.mode === 'CUSTOM_NWC' && addr.remoteWalletId) {
      edges.push({
        id: `e:la:${addr.username}->${addr.remoteWalletId}`,
        type: 'highlight',
        source: addressNodeId(addr.username),
        target: walletNodeId(addr.remoteWalletId),
        reconnectable: 'target',
        style: { stroke: 'oklch(0.78 0.18 162)' /* emerald */, strokeWidth: 1.5 },
      })
    } else if (addr.mode === 'DEFAULT_NWC' && defaultWallet) {
      edges.push({
        id: `e:la:${addr.username}->default:${defaultWallet.id}`,
        type: 'highlight',
        source: addressNodeId(addr.username),
        target: walletNodeId(defaultWallet.id),
        reconnectable: 'target',
        style: {
          stroke: 'oklch(0.78 0.18 162)',
          strokeWidth: 1.5,
          strokeDasharray: '4 4',
        },
      })
    }
  }

  // Card bindings: solid edge for explicit `remoteWalletId`. Cards without
  // a binding render as orphan nodes (no edge) — they spend through the
  // owner's default wallet at run-time, but the map shows only what's
  // explicitly bound to keep visual signal clean.
  for (const card of cards ?? []) {
    if (!card.remoteWalletId) continue
    edges.push({
      id: `e:card:${card.id}->${card.remoteWalletId}`,
      type: 'highlight',
      source: cardNodeId(card.id),
      target: walletNodeId(card.remoteWalletId),
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
