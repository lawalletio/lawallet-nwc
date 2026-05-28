'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Smoothly interpolate a displayed number from its previous value toward a
 * new target — the "odometer" effect used in the Connection Map's wallet
 * balance line.
 *
 * Implementation:
 *  - Each time `target` changes, we snapshot the CURRENT displayed value
 *    via a ref (so the animation always starts where the last frame left
 *    off, not where the previous animation started) and kick off a fresh
 *    requestAnimationFrame loop.
 *  - `easeOutCubic` decelerates near the end so larger jumps feel
 *    deliberate rather than linear / jittery.
 *  - The effect intentionally only depends on `target` / `durationMs` —
 *    the ref pattern means the latest `displayed` is read at the start
 *    of every animation without re-triggering the effect on each frame.
 *
 * Returns an integer (rounded) so consumers don't have to format
 * fractional sats. If `target` is `null` (no data yet), the hook holds
 * whatever was last displayed.
 */
export function useAnimatedNumber(
  target: number | null,
  durationMs: number = 600,
): number {
  const [displayed, setDisplayed] = useState<number>(target ?? 0)
  // Mirror `displayed` into a ref via a post-commit effect so the
  // animation effect below can read the latest value without depending
  // on `displayed` (which would re-trigger the effect every frame).
  // Assigning the ref directly during render trips the
  // react-hooks/immutability lint rule.
  const displayedRef = useRef(displayed)
  useEffect(() => {
    displayedRef.current = displayed
  }, [displayed])

  useEffect(() => {
    if (target == null) return
    const from = displayedRef.current
    if (from === target) return

    const startedAt = performance.now()
    let raf = 0
    const tick = () => {
      const elapsed = performance.now() - startedAt
      const t = Math.min(1, elapsed / durationMs)
      // easeOutCubic — fast start, gentle settle.
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplayed(from + (target - from) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  return Math.round(displayed)
}
