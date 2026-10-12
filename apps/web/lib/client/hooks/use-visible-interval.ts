'use client'

import { useEffect, useRef } from 'react'

/**
 * Calls `callback` every `ms` while the tab is visible, and once right away
 * when a hidden tab becomes visible again so the data is fresh on return.
 * Background tabs make no requests. The latest `callback` is always used
 * without resetting the timer.
 */
export function useVisibleInterval(
  callback: () => void,
  ms: number,
  enabled = true
): void {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  })

  useEffect(() => {
    if (!enabled) return
    const tick = () => {
      if (!document.hidden) callbackRef.current()
    }
    const id = setInterval(tick, ms)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [ms, enabled])
}
