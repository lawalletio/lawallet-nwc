'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Smoothly interpolate a displayed number from its previous value toward a
 * new target — the "odometer" effect used in the Connection Map's wallet
 * balance line and detail dialogs.
 *
 * Design:
 *  - When no animation is in flight, the hook returns `target` directly
 *    (no state involved). That's what makes the FIRST non-null target
 *    a clean snap with no count-up — we just render the real value
 *    instead of running a slow eased curve from 0 to N at mount, which
 *    used to read as jank ("trabada"), especially for large numbers.
 *  - When `target` changes (and we've already seen one before), an
 *    `easeOutCubic`-driven requestAnimationFrame loop sweeps a
 *    `displayed` state from the last visible value toward the new
 *    target. Once it lands, `displayed` clears back to null and the
 *    hook returns `target` again.
 *  - Mid-animation interruption: if `target` changes while another
 *    animation is running, the cleanup cancels the in-flight rAF and
 *    the new effect picks up from `displayed` (the last drawn frame),
 *    not from the original source — so the handoff is smooth even if
 *    the user mashes refreshes or SSE bumps multiple times in a row.
 *
 * No synchronous `setState` is fired from inside an effect body — all
 * state writes happen inside the rAF callback, which keeps
 * `react-hooks/set-state-in-effect` happy without forcing us to skip
 * the boot animation via a one-shot snap path.
 *
 * Returns an integer (rounded) so consumers don't have to format
 * fractional sats.
 */
export function useAnimatedNumber(
  target: number | null,
  durationMs: number = 600,
): number {
  // `displayed` is the value being rendered ONLY while an animation is
  // running. When idle (no animation), it's null and the hook returns
  // `target` directly — that's the snap-on-first-value behaviour.
  const [displayed, setDisplayed] = useState<number | null>(null)

  // Mirror `displayed` for read inside the next effect without
  // depending on it (which would tear down + rebuild the animation
  // every frame).
  const displayedRef = useRef<number | null>(null)
  useEffect(() => {
    displayedRef.current = displayed
  }, [displayed])

  // Last `target` we kicked off (or snapped to). null until the first
  // non-null target — that gates the boot snap below.
  const seenTargetRef = useRef<number | null>(null)

  useEffect(() => {
    if (target == null) return

    // First non-null target — snap. We don't touch state here: the JSX
    // already returns `target` directly because `displayed` is null.
    if (seenTargetRef.current == null) {
      seenTargetRef.current = target
      return
    }

    if (seenTargetRef.current === target) return

    // Start an animation from whatever the user can currently see —
    // either the previous frame of an in-flight animation, or the
    // last settled `target` if we're idle. This keeps the visual
    // continuous across rapid target changes.
    const from = displayedRef.current ?? seenTargetRef.current
    seenTargetRef.current = target

    const startedAt = performance.now()
    let raf = 0
    const tick = () => {
      const elapsed = performance.now() - startedAt
      const t = Math.min(1, elapsed / durationMs)
      if (t >= 1) {
        // Animation complete — clear `displayed` so the hook returns
        // `target` directly on the next render. Keeps the rendered
        // value pinned exactly to the source of truth between
        // animations instead of drifting on rounded mid-frame values.
        setDisplayed(null)
        return
      }
      // easeOutCubic — fast start, gentle settle.
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplayed(from + (target - from) * eased)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])

  if (target == null) return 0
  return displayed != null ? Math.round(displayed) : target
}
