'use client'

import { useState } from 'react'

/**
 * The current time, sampled once when the component first mounts.
 *
 * Reading the clock inside the render body is impure: two renders of the same
 * props would disagree, and on a prerendered page it also guarantees a
 * hydration mismatch. A lazy `useState` initializer runs exactly once per
 * component instance, which makes the value stable for that instance's
 * lifetime.
 *
 * It does not tick. Every consumer so far renders day-granularity copy
 * ("Expires in 3 days"), which cannot go stale while a page is open. Add an
 * interval here if something ever needs a live countdown.
 */
export function useNow(): number {
  const [now] = useState(() => Date.now())
  return now
}
