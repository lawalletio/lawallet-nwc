'use client'

import React from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import { useHover } from './hover-context'

/** Shape of the `data` we attach to edges in `buildGraph`. */
interface HighlightEdgeData {
  /** Tooltip headline — the binding type, e.g. `CUSTOM_NWC`. */
  tooltipTitle?: string
  /** One-line plain-language explanation shown under the title. */
  tooltipHint?: string
}

/**
 * Default-shaped bezier edge that dims itself when something *else* is
 * hovered. Lives in this component (not in the edge object) so the
 * `edges` array passed to `<ReactFlow>` can stay stable — only this
 * component re-renders on hover changes, no full graph reconciliation.
 *
 * When the cursor is DIRECTLY over this edge (tracked via
 * `activeEdgeId` in HoverContext), a small tooltip renders at the edge
 * midpoint explaining the binding type (CUSTOM_NWC / DEFAULT_NWC for
 * address edges, a short label for card edges). We gate on
 * `activeEdgeId` rather than the broader `highlight.edges` set so only
 * the one edge under the pointer is labelled — not every edge in the
 * hovered node's connected component.
 */
export function HighlightEdge({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
}: EdgeProps) {
  const { highlight, activeEdgeId } = useHover()
  const active = !highlight || highlight.edges.has(id)
  const showTooltip = activeEdgeId === id

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const d = (data ?? {}) as HighlightEdgeData

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          ...style,
          opacity: active ? 1 : 0.15,
          // Slightly thicker when an active highlight is in play, so the
          // currently-relevant binding pops without the resting state
          // changing thickness.
          strokeWidth: active && highlight ? 2.5 : ((style?.strokeWidth as number | undefined) ?? 1.5),
          transition: 'opacity 120ms ease, stroke-width 120ms ease',
        }}
        markerEnd={markerEnd}
      />
      {showTooltip && d.tooltipTitle && (
        <EdgeLabelRenderer>
          <div
            // `nodrag nopan` keeps a pointer over the label from
            // panning the canvas. Positioned at the bezier midpoint
            // (labelX/Y are canvas coords; the transform re-centres on
            // the point). `pointer-events-none` so the label never
            // steals the hover from the edge beneath it (which would
            // flicker the tooltip on/off).
            className="nodrag nopan pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-popover px-2 py-1 text-center shadow-md animate-in fade-in-0 zoom-in-95 duration-100"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground">
              {d.tooltipTitle}
            </div>
            {d.tooltipHint && (
              <div className="text-[10px] leading-tight text-muted-foreground">
                {d.tooltipHint}
              </div>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
