'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { sanitizePagePath } from '@/lib/analytics/gtag'

interface RouteChangeTrackerProps {
  gtagId: string
}

/**
 * Fires a `page_view` event on every App Router navigation. Wrapped in
 * `<Suspense>` by the parent because `useSearchParams` requires it.
 *
 * Sensitive query params (invoice, lnurl, token, etc.) are stripped from
 * `page_path` before reporting — see `sanitizePagePath`.
 */
export function RouteChangeTracker({ gtagId }: RouteChangeTrackerProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.gtag !== 'function') {
      return
    }
    const pagePath = sanitizePagePath(pathname, searchParams)
    window.gtag('event', 'page_view', {
      page_path: pagePath,
      send_to: gtagId,
    })
  }, [pathname, searchParams, gtagId])

  return null
}
