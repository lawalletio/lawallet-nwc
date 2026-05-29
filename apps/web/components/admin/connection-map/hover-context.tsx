'use client'

import { createContext, useContext } from 'react'

/**
 * Hover state shared between the canvas, node components, and the custom
 * edge. Lives in a Context so a hover change re-renders only the consumers
 * (the node/edge components) — never the `nodes`/`edges` arrays passed to
 * `<ReactFlow>`. That's what prevents the flicker we'd otherwise get on
 * every mouse-enter (entire node array changing identity → ReactFlow
 * reconciles every DOM node → cursor loses its target → mouseLeave fires
 * → feedback loop).
 */
export interface HighlightSet {
  /** Node ids that should stay at full opacity. */
  nodes: Set<string>
  /** Edge ids that should stay at full opacity. */
  edges: Set<string>
}

export interface HoverContextValue {
  /** `null` = nothing hovered; everything renders at full opacity. */
  highlight: HighlightSet | null
  /**
   * Id of the edge the cursor is DIRECTLY over (not merely part of the
   * hovered node's connected component). Drives the per-edge tooltip in
   * `HighlightEdge` — we only want to label the one edge under the
   * pointer, not every edge that happens to be highlighted.
   */
  activeEdgeId: string | null
}

const HoverContext = createContext<HoverContextValue>({
  highlight: null,
  activeEdgeId: null,
})

export const HoverProvider = HoverContext.Provider

export function useHover(): HoverContextValue {
  return useContext(HoverContext)
}
