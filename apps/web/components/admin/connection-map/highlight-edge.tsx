'use client'

import React from 'react'
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import { useHover } from './hover-context'

/**
 * Default-shaped bezier edge that dims itself when something *else* is
 * hovered. Lives in this component (not in the edge object) so the
 * `edges` array passed to `<ReactFlow>` can stay stable — only this
 * component re-renders on hover changes, no full graph reconciliation.
 */
export function HighlightEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
}: EdgeProps) {
  const { highlight } = useHover()
  const active = !highlight || highlight.edges.has(id)

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
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
  )
}
