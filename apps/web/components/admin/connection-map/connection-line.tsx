'use client'

import React from 'react'
import { getBezierPath, type ConnectionLineComponentProps } from '@xyflow/react'

/**
 * Palette — kept in lock-step with the edge colours in `buildGraph`
 * (connection-map.tsx) so the in-flight preview reads as the same kind
 * of wire it will become once dropped.
 */
const EMERALD = 'oklch(0.78 0.18 162)' // LA → wallet
const SKY = 'oklch(0.72 0.16 245)' //     wallet → card
const INVALID = 'oklch(0.62 0.22 25)' //  drop target rejected

/**
 * Custom connection line — the wire React Flow draws WHILE the user is
 * dragging from a handle, before they release on a target.
 *
 * Why a custom component instead of the default line:
 *  - Bezier path via `getBezierPath` so the preview curve matches the
 *    resting `HighlightEdge` shape exactly (the default line is a plain
 *    straight segment, which then "snaps" into a curve on release).
 *  - Colour tracks `connectionStatus`: the source-appropriate hue
 *    (emerald for an LA source, sky for a wallet source) when hovering
 *    a valid target, red when the target is invalid, and a dimmed
 *    source hue while floating over empty canvas.
 *  - A filled dot at BOTH ends — the anchored source handle and the
 *    cursor end — so the line reads as a graspable wire whose far end
 *    tracks the pointer. The dashes march (CSS animation in
 *    connection-map.css) so the wire feels live while it's being drawn.
 */
export function ConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionStatus,
  fromNode,
}: ConnectionLineComponentProps) {
  // Wallet source handle (`to-card`) is sky; everything else (LA `out`)
  // is emerald. Mirrors the edge stroke colours.
  const base = fromNode?.type === 'remote-wallet' ? SKY : EMERALD
  const stroke = connectionStatus === 'invalid' ? INVALID : base
  // Dim while floating over empty space; full strength once we're over
  // a valid (or invalid — red wants to be loud) handle.
  const opacity = connectionStatus == null ? 0.5 : 1

  const [path] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  })

  return (
    <g style={{ opacity }}>
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeDasharray="4 4"
        className="connection-map-line"
      />
      {/* Anchored end — sits on the source handle. */}
      <circle cx={fromX} cy={fromY} r={3} fill={stroke} />
      {/* Cursor end — tracks the pointer; a thin light ring lifts it off
          the dark canvas so it reads as the "live" grab point. */}
      <circle
        cx={toX}
        cy={toY}
        r={3.5}
        fill={stroke}
        stroke="white"
        strokeWidth={1}
      />
    </g>
  )
}
