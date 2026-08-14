'use client'

import { useEffect, useState } from 'react'

/**
 * The value, but only after it has stopped changing for `delayMs`.
 *
 * Note this is deliberately not `useDebouncedCallback` from the settings
 * controls: that one defers an *action* (a save), this one defers a *value* a
 * render depends on. Wrapping the callback version to derive a value costs an
 * extra state round-trip and reads worse at the call site.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
