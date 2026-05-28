'use client'

import React, { useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useRemoteWallets, type RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import { useMyAddresses, type WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'
import { useCards, type CardData } from '@/lib/client/hooks/use-cards'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { Spinner } from '@/components/ui/spinner'
import { nodeTypes, NODE_LAYOUT } from './nodes'

/** Stable id helpers — used by both nodes and edges so they always agree. */
const walletNodeId = (id: string) => `wallet:${id}`
const addressNodeId = (username: string) => `la:${username}`
const cardNodeId = (id: string) => `card:${id}`

/**
 * Two-column connection map: Lightning Addresses + Cards on the left,
 * Remote Wallets on the right, bezier edges for every active binding.
 *
 * Read-only in this slice (slice 1 of #235). Drag-to-rebind + click panels
 * + keyboard navigation land in follow-up commits on this branch.
 *
 * Positions are deterministic (no auto-layout) so the canvas stays stable
 * across re-renders / SSE refreshes — each row computes its y from its
 * index in the source list.
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

  // Track hover so we can dim everything that isn't connected to it.
  // Hovering a node highlights its edges + the nodes on the other end;
  // hovering an edge highlights its two endpoints.
  const [hovered, setHovered] = useState<{ kind: 'node' | 'edge'; id: string } | null>(null)

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

  // Apply dim/highlight by mutating the data + style fields. We rebuild
  // light wrappers rather than mutating in place so React notices the
  // change and re-renders.
  const renderedNodes: Node[] = useMemo(
    () =>
      nodes.map(n => ({
        ...n,
        data: { ...n.data, dimmed: highlight ? !highlight.nodes.has(n.id) : false },
      })),
    [nodes, highlight],
  )
  const renderedEdges: Edge[] = useMemo(
    () =>
      edges.map(e => {
        const active = !highlight || highlight.edges.has(e.id)
        return {
          ...e,
          animated: active && !!highlight,
          style: {
            ...(e.style ?? {}),
            opacity: active ? 1 : 0.15,
            strokeWidth: active && highlight ? 2.5 : 1.5,
          },
        }
      }),
    [edges, highlight],
  )

  if (loading && !nodes.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={24} className="text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="h-full">
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        // Read-only canvas: positions are deterministic, no UI dragging,
        // no edge dragging. Slice 3 enables wallet-handle drags for rebind.
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeMouseEnter={(_, n) => setHovered({ kind: 'node', id: n.id })}
        onNodeMouseLeave={() => setHovered(null)}
        onEdgeMouseEnter={(_, e) => setHovered({ kind: 'edge', id: e.id })}
        onEdgeMouseLeave={() => setHovered(null)}
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
  // Address bindings:
  //   CUSTOM_NWC  → solid edge to the address's bound wallet.
  //   DEFAULT_NWC → dashed edge to the user's default wallet (implicit).
  //   IDLE / ALIAS → no edge (no wallet involved).
  for (const addr of addresses ?? []) {
    if (addr.mode === 'CUSTOM_NWC' && addr.remoteWalletId) {
      edges.push({
        id: `e:la:${addr.username}->${addr.remoteWalletId}`,
        type: 'default',
        source: addressNodeId(addr.username),
        target: walletNodeId(addr.remoteWalletId),
        style: { stroke: 'oklch(0.78 0.18 162)' /* emerald */, strokeWidth: 1.5 },
      })
    } else if (addr.mode === 'DEFAULT_NWC' && defaultWallet) {
      edges.push({
        id: `e:la:${addr.username}->default:${defaultWallet.id}`,
        type: 'default',
        source: addressNodeId(addr.username),
        target: walletNodeId(defaultWallet.id),
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
      type: 'default',
      source: cardNodeId(card.id),
      target: walletNodeId(card.remoteWalletId),
      style: { stroke: 'oklch(0.72 0.16 245)' /* sky */, strokeWidth: 1.5 },
    })
  }

  return { nodes, edges }
}

// ── Hover highlighting ────────────────────────────────────────────────────

interface HighlightSet {
  /** Node ids that should stay at full opacity. */
  nodes: Set<string>
  /** Edge ids that should stay at full opacity. */
  edges: Set<string>
}

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
