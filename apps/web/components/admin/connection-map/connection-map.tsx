'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
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
import {
  useMyCards,
  useCardMutations,
  type CardData,
} from '@/lib/client/hooks/use-cards'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { Spinner } from '@/components/ui/spinner'
import { truncateHex } from '@/lib/client/format'
import { nodeTypes, NODE_LAYOUT } from './nodes'
import { HoverProvider, type HighlightSet } from './hover-context'
import { HighlightEdge } from './highlight-edge'
import { ConnectionLine } from './connection-line'
import {
  ConnectionDetailDialog,
  type ConnectionSelection,
} from './connection-detail-dialog'
import { getPrimaryWallet, withDerivedPrimaryWalletFlags } from './primary-wallet'

/** Stable id helpers — used by both nodes and edges so they always agree. */
const walletNodeId = (id: string) => `wallet:${id}`
const addressNodeId = (username: string) => `la:${username}`
const cardNodeId = (id: string) => `card:${id}`

/** Inverse helpers — extract the model id from a node id, or null if the prefix doesn't match. */
const usernameFromNodeId = (nodeId: string | null | undefined): string | null =>
  nodeId && nodeId.startsWith('la:') ? nodeId.slice('la:'.length) : null
const walletIdFromNodeId = (nodeId: string | null | undefined): string | null =>
  nodeId && nodeId.startsWith('wallet:') ? nodeId.slice('wallet:'.length) : null
const cardIdFromNodeId = (nodeId: string | null | undefined): string | null =>
  nodeId && nodeId.startsWith('card:') ? nodeId.slice('card:'.length) : null

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
  // The page is reachable by EVERY authenticated role (the admin layout only
  // gates on auth, not role). All three sources are per-caller, so they're
  // fine for anyone: `/api/remote-wallets`, `/api/wallet/addresses`, and
  // `/api/wallet/cards` — the last returns only the cards paired to the
  // logged-in account, so even an admin sees just their own here (and there's
  // no client-side pubkey matching that could hide a freshly paired card).
  const { data: cards, loading: cardsLoading } = useMyCards()

  const loading = walletsLoading || addressesLoading || cardsLoading
  const domain = settings?.domain || 'your-domain'
  // When the user has no wallets, offer a one-tap LNCurl wallet (ghost node)
  // — but only if the operator enabled the integration.
  const lncurlEnabled = settings?.lncurl_enabled === 'true'
  const walletList = useMemo(
    () => withDerivedPrimaryWalletFlags(wallets, addresses),
    [wallets, addresses],
  )

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

  // Clicking a node opens its detail dialog (the shared
  // ConnectionDetailDialog). We track the selection by kind + raw id (no
  // node-id prefix) so the bodies can look the entity up in the local
  // lists without re-parsing prefixes themselves.
  const [selected, setSelected] = useState<ConnectionSelection>(null)

  // `onReconnect` and `onReconnectEnd` cooperate via this ref to detect
  // "edge dragged off into empty space" (the official xyflow pattern, see
  // https://reactflow.dev/learn/advanced-use/delete-edges-on-drop). The
  // ref starts at true so a fresh drag that never lands anywhere ends up
  // calling the disconnect path.
  const edgeReconnectSuccessful = useRef(true)

  const { updateAddress } = useAddressMutations()
  const { updateCard } = useCardMutations()

  /** Primary-address wallet drives the implicit binding for DEFAULT_NWC addresses. */
  const defaultWallet = useMemo(
    () => getPrimaryWallet(walletList, addresses),
    [walletList, addresses],
  )

  const { nodes: computedNodes, edges: computedEdges } = useMemo(
    () =>
      buildGraph({
        wallets: walletList,
        addresses,
        cards,
        defaultWallet,
        domain,
        lncurlEnabled,
      }),
    [walletList, addresses, cards, defaultWallet, domain, lncurlEnabled],
  )

  // ReactFlow needs to OWN the node/edge state (via these hooks) rather than
  // being fully controlled off the `buildGraph` memo. Fully-controlled mode
  // without `onNodesChange` can't persist each node's *measured* dimensions —
  // so when a data refetch (e.g. an SSE `cards:updated` after a drag-rebind)
  // hands ReactFlow a brand-new `nodes` array, the fresh objects arrive
  // unmeasured and every edge loses its handle anchoring and disappears until
  // a full reload. Owning the state + re-applying the freshly computed graph
  // while carrying the measured dimensions forward keeps the edges anchored.
  const [nodes, setNodes, onNodesChange] = useNodesState(computedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(computedEdges)

  useEffect(() => {
    setNodes(prev => {
      const prevById = new Map(prev.map(n => [n.id, n]))
      return computedNodes.map(n => {
        const old = prevById.get(n.id)
        // Carry xyflow's measured size (+ width/height) forward by id so the
        // replacement nodes can anchor their handles immediately.
        return old?.measured
          ? { ...n, measured: old.measured, width: old.width, height: old.height }
          : n
      })
    })
  }, [computedNodes, setNodes])

  useEffect(() => {
    setEdges(computedEdges)
  }, [computedEdges, setEdges])

  // Compute the highlight set. When nothing is hovered, everything renders
  // at full opacity (no dimming).
  const highlight = useMemo(
    () => computeHighlight(hovered, edges),
    [hovered, edges],
  )

  // The edge directly under the cursor (vs. merely highlighted as part
  // of a hovered node's component) — drives the per-edge tooltip.
  const activeEdgeId = hovered?.kind === 'edge' ? hovered.id : null

  // Memoise the context value so consumers only re-render when `highlight`
  // or `activeEdgeId` actually changes — not on every render of this
  // component (e.g. while `isPanning` flips during a drag).
  const hoverValue = useMemo(
    () => ({ highlight, activeEdgeId }),
    [highlight, activeEdgeId],
  )

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
      const current = addresses?.find(addr => addr.username === username)
      if (current?.mode === 'CUSTOM_NWC' && current.remoteWalletId === walletId) {
        toast.info(`${username} is already bound to that wallet`)
        return
      }

      try {
        const updated = await updateAddress(username, {
          mode: 'CUSTOM_NWC',
          remoteWalletId: walletId,
        })
        if (updated.mode !== 'CUSTOM_NWC' || updated.remoteWalletId !== walletId) {
          throw new Error('Wallet binding did not change')
        }
        toast.success(`${username} bound to wallet`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not bind address'
        toast.error(msg)
      }
    },
    [addresses, updateAddress],
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

  const bindCardToWallet = useCallback(
    async (cardId: string, walletId: string) => {
      try {
        await updateCard(cardId, { remoteWalletId: walletId })
        toast.success('Card bound to wallet')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not bind card'
        toast.error(msg)
      }
    },
    [updateCard],
  )

  const disconnectCard = useCallback(
    async (cardId: string) => {
      try {
        await updateCard(cardId, { remoteWalletId: null })
        toast.success('Card unbound')
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not unbind card'
        toast.error(msg)
      }
    },
    [updateCard],
  )

  const handleConnectStart = useCallback(() => setIsConnecting(true), [])
  const handleConnectEnd = useCallback(() => setIsConnecting(false), [])

  // New edge created by dragging from a source handle onto a target handle.
  // Two valid shapes:
  //   - LA source → wallet target (`from-la`): bind LA to wallet.
  //   - Wallet source (`to-card`) → card target: bind card to wallet.
  // `isValidConnection` already rejects anything else before we get here,
  // but we re-check the prefixes so a future handle id rename doesn't
  // silently break the dispatch.
  const handleConnect = useCallback(
    (connection: Connection) => {
      const sourceLa = usernameFromNodeId(connection.source)
      const sourceWallet = walletIdFromNodeId(connection.source)
      if (sourceLa) {
        const walletId = walletIdFromNodeId(connection.target)
        if (walletId) bindAddressToWallet(sourceLa, walletId)
        return
      }
      if (sourceWallet) {
        const cardId = cardIdFromNodeId(connection.target)
        if (cardId) bindCardToWallet(cardId, sourceWallet)
      }
    },
    [bindAddressToWallet, bindCardToWallet],
  )

  const handleReconnectStart = useCallback(() => {
    edgeReconnectSuccessful.current = false
    setIsConnecting(true)
  }, [])

  // Existing edge dragged onto a new handle. Which model row we PATCH
  // depends on which END of the edge moved:
  //
  //   LA edge (la:* → wallet:*), reconnectable on the wallet end:
  //     · target moved (wallet end): newConnection.source is still the
  //       original LA → rebind that LA to the new wallet.
  //     · source moved (LA end): not supported. The LA source handle still
  //       creates fresh connections, but the existing edge itself should not
  //       be reconnected from that end; otherwise a source-end drag can look
  //       like a wallet change while still reporting the old wallet.
  //
  //   Card edge (wallet:* → card:*): target = card (fixed), source =
  //     wallet (new) → rebind that card to the new wallet.
  const handleReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      edgeReconnectSuccessful.current = true

      const oldLaUser = usernameFromNodeId(oldEdge.source)
      if (oldLaUser) {
        const walletId = walletIdFromNodeId(newConnection.target)
        if (!walletId) return
        const newLaUser = usernameFromNodeId(newConnection.source)
        if (newLaUser && newLaUser !== oldLaUser) {
          // Source end moved to a different LA → move the binding.
          bindAddressToWallet(newLaUser, walletId)
          disconnectAddress(oldLaUser)
        } else {
          // Target end moved (or dropped back on the same LA) → rebind
          // this LA to whatever wallet it now points at.
          bindAddressToWallet(oldLaUser, walletId)
        }
        return
      }

      const cardId = cardIdFromNodeId(oldEdge.target)
      if (cardId) {
        const walletId = walletIdFromNodeId(newConnection.source)
        if (walletId) bindCardToWallet(cardId, walletId)
      }
    },
    [bindAddressToWallet, disconnectAddress, bindCardToWallet],
  )

  // Edge dropped on empty space: disconnect. The ref pattern means we land
  // here only when `handleReconnect` did NOT run for the same drag. We
  // detect which edge family this is by which prefix the endpoints carry.
  const handleReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: Edge) => {
      setIsConnecting(false)
      if (edgeReconnectSuccessful.current) {
        edgeReconnectSuccessful.current = true
        return
      }
      edgeReconnectSuccessful.current = true
      const username = usernameFromNodeId(edge.source)
      if (username) {
        disconnectAddress(username)
        return
      }
      const cardId = cardIdFromNodeId(edge.target)
      if (cardId) disconnectCard(cardId)
    },
    [disconnectAddress, disconnectCard],
  )

  // Click on a node body (not a handle drag) opens its detail dialog.
  // Header nodes are skipped — they're decorative column labels.
  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    const username = usernameFromNodeId(node.id)
    if (username) {
      setSelected({ kind: 'la', username })
      return
    }
    const walletId = walletIdFromNodeId(node.id)
    if (walletId) {
      setSelected({ kind: 'wallet', id: walletId })
      return
    }
    const cardId = cardIdFromNodeId(node.id)
    if (cardId) {
      setSelected({ kind: 'card', id: cardId })
    }
    // Header nodes (id="header:*") fall through and do nothing.
  }, [])

  // Reject invalid drops while the user is dragging — xyflow paints the
  // ghost edge red so the affordance reads as "this won't work" before
  // release. Two valid shapes match the two edge families:
  //   1. LA SOURCE → wallet TARGET, targetHandle `from-la` (LA→wallet).
  //   2. Wallet SOURCE → card TARGET, sourceHandle `to-card` (wallet→card).
  // Anything else (wrong direction, wrong handle on the wallet, etc.) is
  // rejected so partial-typing the wrong handle is impossible.
  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const sourceLa = !!connection.source?.startsWith('la:')
    const sourceWallet = !!connection.source?.startsWith('wallet:')
    const targetWallet = !!connection.target?.startsWith('wallet:')
    const targetCard = !!connection.target?.startsWith('card:')

    if (sourceLa && targetWallet) {
      if (connection.targetHandle && connection.targetHandle !== 'from-la') return false
      return true
    }
    if (sourceWallet && targetCard) {
      if (connection.sourceHandle && connection.sourceHandle !== 'to-card') return false
      return true
    }
    return false
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
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          // The app shell is always dark, so we hardcode dark here too.
          // This flips xyflow's internal CSS vars
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
          // Custom in-flight connection line: a bezier preview that
          // matches the resting edges, colour-coded by drop validity,
          // with a marching-ants animation + dots on both ends so the
          // wire reads as live while the user drags it (see
          // ./connection-line.tsx).
          connectionLineComponent={ConnectionLine}
          isValidConnection={isValidConnection}
          onNodeClick={handleNodeClick}
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

        <ConnectionDetailDialog
          selected={selected}
          onSelect={setSelected}
          addresses={addresses}
          cards={cards}
          wallets={walletList}
          domain={domain}
        />
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
  /** When the wallet column is empty, render a ghost LNCurl create-CTA node. */
  lncurlEnabled: boolean
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
 * Edge handle ids must match `nodes.tsx`. The two edge families flow in
 * opposite directions so the dragged end is always a SOURCE handle:
 *   - LA edge:   LA     `out`    (right) → Wallet `from-la` (left)
 *   - Card edge: Wallet `to-card`(right) → Card   `in`      (left)
 */
function buildGraph({
  wallets,
  addresses,
  cards,
  defaultWallet,
  domain,
  lncurlEnabled,
}: BuildGraphInput): BuiltGraph {
  const { addressX, walletX, cardX, rowGap, cardRowGap, topY } = NODE_LAYOUT
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
        data: {
          username: addr.username,
          domain,
          mode: addr.mode,
          isPrimary: addr.isPrimary,
        },
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
        data: {
          // `walletId` (without the "wallet:" prefix) is what the live
          // balance hook inside RemoteWalletNode needs — we pass it
          // explicitly rather than re-parsing the node id at render time.
          walletId: w.id,
          name: w.name,
          type: w.type,
          status: w.status,
          isDefault: w.isDefault,
        },
      })
      y += rowGap
    }
  } else if (lncurlEnabled) {
    // No wallets yet — offer a one-tap LNCurl wallet in the wallet column.
    // The `ghost:` prefix doesn't match any node-id parser, so clicking the
    // node body is inert (the button inside owns the action).
    nodes.push({
      id: 'header:wallets',
      type: 'header',
      position: { x: walletX, y },
      data: { label: 'Remote Wallets' },
      draggable: false,
      selectable: false,
    })
    y += rowGap
    nodes.push({
      id: 'ghost:wallet',
      type: 'ghost-wallet',
      position: { x: walletX, y },
      data: {},
      draggable: false,
      selectable: false,
    })
  }

  // ── Column 3 (right): Cards ─────────────────────────────────────────────
  // Card "label" priority: admin-set `title` → bound LA username (paired
  // cards) → `first8...last8` truncation of the card id. The truncation
  // keeps even legacy / orphan rows distinguishable, but a real title is
  // what the admin actually thinks of as the card's name, so it wins.
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
    // Header → first card uses the standard `rowGap` so the cards-column
    // header lines up with the other columns. Between cards uses the
    // taller `cardRowGap` so the full-width design previews don't stack
    // into each other.
    y += rowGap
    for (const card of cards) {
      nodes.push({
        id: cardNodeId(card.id),
        type: 'card',
        position: { x: cardX, y },
        data: {
          label:
            card.title ?? card.lightningAddress?.username ?? truncateHex(card.id),
          designName: card.design?.description ?? null,
          designImage: card.design?.image ?? null,
          // "Paired" === linked to a user (the card has an owner), never
          // "has an NFC chip". Matches the userId-based semantics used by the
          // counts + /api/cards `paired` filter.
          paired: !!card.lightningAddress,
        },
      })
      y += cardRowGap
    }
  }

  // ── Edges ───────────────────────────────────────────────────────────────
  // All edges use the 'highlight' custom edge type so they can read the
  // current hover from HoverContext and dim themselves locally — no
  // rebuilding of the edges array required.
  //
  // `reconnectable` per-edge:
  //   - LA edges: 'target' — only the wallet end of the existing edge is
  //     draggable. The LA output handle remains connectable for creating a
  //     new bind, but the existing edge's source endpoint is intentionally
  //     inert so a wallet rebind cannot resolve back to the old wallet while
  //     still showing a success toast.
  //   - Card edges: 'source' — drag the wallet end (which IS the source
  //     since the edge points wallet → card) to rebind / disconnect.
  //     The card end stays put.
  //
  // Address bindings:
  //   CUSTOM_NWC   → solid edge to the address's bound wallet.
  //   DEFAULT_NWC  → dashed edge to the primary address's wallet (implicit).
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
        data: {
          tooltipTitle: 'CUSTOM_NWC',
          tooltipHint: 'Bound to this specific wallet',
        },
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
        data: {
          tooltipTitle: 'DEFAULT_NWC',
          tooltipHint: 'Routes through the primary address wallet',
        },
        style: {
          stroke: 'oklch(0.78 0.18 162)',
          strokeWidth: 1.5,
          strokeDasharray: '4 4',
        },
      })
    }
  }

  // Card bindings: edge flows wallet → card (the wallet "owns" the card
  // visually) so the wallet's right dot can initiate a drag. The
  // underlying API still sets `card.remoteWalletId = wallet.id` — the
  // edge direction is purely a UX choice.
  for (const card of cards ?? []) {
    if (!card.remoteWalletId) continue
    edges.push({
      id: `e:card:${card.remoteWalletId}->${card.id}`,
      type: 'highlight',
      source: walletNodeId(card.remoteWalletId),
      sourceHandle: 'to-card',
      target: cardNodeId(card.id),
      targetHandle: 'in',
      reconnectable: 'source',
      data: {
        tooltipTitle: 'CARD',
        tooltipHint: 'Card spends from this wallet',
      },
      style: { stroke: 'oklch(0.72 0.16 245)' /* sky */, strokeWidth: 1.5 },
    })
  }

  return { nodes, edges }
}

// ── Hover highlighting ────────────────────────────────────────────────────

/**
 * Walks the WHOLE connected component the hovered node/edge belongs to,
 * not just its immediate neighbours. That way hovering a Lightning
 * Address spotlights the LA → its wallet → every card bound to that
 * wallet (and vice versa from any of those), so the user sees the full
 * chain a payment can traverse in one glance.
 *
 * Implementation: BFS over the edge list with a frontier queue. The
 * graph is small (handful of nodes, dozen-ish edges in practice), so
 * we re-scan all edges per frontier pop instead of pre-building an
 * adjacency map — easier to follow and not a perf concern.
 */
function computeHighlight(
  hovered: { kind: 'node' | 'edge'; id: string } | null,
  edges: Edge[],
): HighlightSet | null {
  if (!hovered) return null

  const keptNodes = new Set<string>()
  const keptEdges = new Set<string>()
  const frontier: string[] = []

  // Seed the BFS depending on what's hovered.
  if (hovered.kind === 'node') {
    keptNodes.add(hovered.id)
    frontier.push(hovered.id)
  } else {
    const e = edges.find(edge => edge.id === hovered.id)
    if (e) {
      keptEdges.add(e.id)
      keptNodes.add(e.source)
      keptNodes.add(e.target)
      frontier.push(e.source, e.target)
    }
  }

  // Expand: for each node in the frontier, pull in every edge that
  // touches it + the node on the other side, then queue that node for
  // its own expansion. Stops naturally when nothing new is discovered.
  while (frontier.length > 0) {
    const node = frontier.shift() as string
    for (const e of edges) {
      if (e.source !== node && e.target !== node) continue
      if (keptEdges.has(e.id)) continue
      keptEdges.add(e.id)
      const other = e.source === node ? e.target : e.source
      if (!keptNodes.has(other)) {
        keptNodes.add(other)
        frontier.push(other)
      }
    }
  }

  return { nodes: keptNodes, edges: keptEdges }
}
