'use client'

import React, { useEffect, useRef, useState } from 'react'

/**
 * Smoothly animates the wrapper's `height` between values as its child's
 * content changes. Used to keep the Wallet detail dialog from jumping
 * when the receive / send sub-flows expand or collapse (e.g., destination
 * input grows by ~40 px when the "Send to Alby" pill renders below it).
 *
 * Approach:
 *  - The inner `<div ref={innerRef}>` is the actual content — its height
 *    is its natural `auto` height since we don't constrain it.
 *  - A `ResizeObserver` watches that inner div and writes its measured
 *    pixel height into state.
 *  - The outer wrapper renders that explicit pixel value and CSS
 *    `transition-[height]` animates between successive measurements.
 *  - `overflow-hidden` clips during the transition so mid-animation
 *    frames don't show the bottom of the new content overflowing the
 *    shrinking previous bounds (or vice versa).
 *
 * The first measurement transitions from "auto" → "<n>px" which CSS
 * can't interpolate; that initial swap is instant by design (we don't
 * want a spurious mount-time animation). Every subsequent layout change
 * animates with `duration-200 ease-out` to match the inner
 * `animate-in fade-in-0 …` transitions, so swap + grow feel like one
 * gesture.
 */
export function AutoHeight({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    const node = innerRef.current
    if (!node) return
    // Seed with the initial natural height so the first render lands
    // on a numeric value (otherwise the very first content swap would
    // be instant, since CSS can't transition from "auto").
    setHeight(node.offsetHeight)

    const observer = new ResizeObserver(entries => {
      // `contentRect.height` excludes padding/border; we want the
      // box-sizing-aware height the wrapper will mirror, so use
      // `offsetHeight` from the observed target.
      const target = entries[0]?.target as HTMLElement | undefined
      if (target) setHeight(target.offsetHeight)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className={`overflow-hidden transition-[height] duration-200 ease-out ${className ?? ''}`}
      style={{ height: height ?? 'auto' }}
    >
      {/*
        `pb-1` (4 px) absorbs the bottom edge of focus rings — inputs in
        this project use `ring-offset-2` which paints 4 px BEYOND the
        box, and without this padding the outer `overflow-hidden` clips
        the bottom of that ring. The measured `offsetHeight` includes
        this padding, so the animated wrapper accommodates it
        automatically.
      */}
      <div ref={innerRef} className="pb-1">
        {children}
      </div>
    </div>
  )
}
