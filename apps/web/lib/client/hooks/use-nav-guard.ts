'use client'

import { useEffect } from 'react'

/**
 * When `active` is true, any primary-button click on an in-app `<a>` link is
 * intercepted and the target URL is passed to `onAttempt`. The consumer
 * decides whether to navigate (e.g. `router.push(url)`) or block.
 *
 * Clicks are let through untouched when:
 * - a modifier key is held (Cmd / Ctrl / Shift / Alt) — open-in-new-tab and similar
 * - the button isn't the primary (left) one
 * - the anchor has `target="_blank"`
 * - the href is external (`http://`, `https://`, `//`), `mailto:`, `tel:`, or hash-only
 * - the target URL matches the current pathname + search (no real navigation)
 */
export function useNavGuard(active: boolean, onAttempt: (url: string) => void) {
  useEffect(() => {
    if (!active) return

    const handler = (e: MouseEvent) => {
      if (e.defaultPrevented) return
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const anchor = (e.target as HTMLElement | null)?.closest('a')
      if (!anchor || anchor.target === '_blank') return

      const href = anchor.getAttribute('href')
      if (!href) return
      if (/^(?:https?:|\/\/|mailto:|tel:|#)/.test(href)) return

      const target = new URL(href, window.location.origin)
      const current = new URL(window.location.href)
      if (target.pathname === current.pathname && target.search === current.search) return

      e.preventDefault()
      e.stopPropagation()
      onAttempt(target.pathname + target.search)
    }

    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [active, onAttempt])
}
