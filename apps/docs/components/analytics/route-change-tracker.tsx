'use client'

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

interface RouteChangeTrackerProps {
  gtagId: string
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

const SENSITIVE_QUERY_KEYS = new Set([
  'invoice',
  'lnurl',
  'code',
  'token',
  'secret',
  'pubkey',
  'npub',
])

function sanitizePagePath(
  pathname: string,
  searchParams?: URLSearchParams | null
): string {
  if (!searchParams) return pathname
  const sp = new URLSearchParams(searchParams)
  for (const key of SENSITIVE_QUERY_KEYS) {
    if (sp.has(key)) sp.delete(key)
  }
  const qs = sp.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/**
 * Fires a `page_view` event on every App Router navigation. Wrapped in
 * `<Suspense>` by the parent because `useSearchParams` requires it.
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
