'use client'

import { Suspense, useLayoutEffect } from 'react'
import Script from 'next/script'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { RouteChangeTracker } from './route-change-tracker'

// G-XXXX / GT-XXXX / AW-XXXX / UA-XXXX-Y. Anything else is a typo or worse.
const GTAG_ID = /^[A-Z]{1,3}-[A-Z0-9-]+$/i

/**
 * Loads the Google Analytics gtag.js script in anonymous mode once the
 * public settings name a `gtag_id`. Renders nothing while it's unset.
 *
 * The ID comes from `/api/settings` on the client (not the root layout) so
 * statically prerendered pages pick it up too.
 *
 * `send_page_view: false` because we send `page_view` events manually
 * from `<RouteChangeTracker>` so SPA navigations are tracked too.
 */
export function GoogleAnalytics() {
  const { data } = useSettings()
  const raw = data?.gtag_id?.trim()
  const gtagId = raw && GTAG_ID.test(raw) ? raw : null

  // Layout effect: the queue must exist before RouteChangeTracker's first
  // page_view effect. gtag.js drains `dataLayer` when it loads.
  useLayoutEffect(() => {
    if (!gtagId || window.gtag) return
    window.dataLayer = window.dataLayer || []
    window.gtag = function gtag() {
      // gtag.js expects the raw `arguments` object, not an array.
      window.dataLayer!.push(arguments)
    }
    window.gtag('js', new Date())
    window.gtag('config', gtagId, {
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      send_page_view: false
    })
  }, [gtagId])

  if (!gtagId) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gtagId}`}
        strategy="afterInteractive"
      />
      <Suspense fallback={null}>
        <RouteChangeTracker gtagId={gtagId} />
      </Suspense>
    </>
  )
}
