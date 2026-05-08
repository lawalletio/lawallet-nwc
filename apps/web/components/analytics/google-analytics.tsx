'use client'

import { Suspense } from 'react'
import Script from 'next/script'
import { RouteChangeTracker } from './route-change-tracker'

interface GoogleAnalyticsProps {
  gtagId?: string | null
}

/**
 * Loads the Google Analytics gtag.js script and configures it in
 * anonymous mode. Renders nothing when `gtagId` is empty / unset, so the
 * tag only runs once the operator has supplied an ID.
 *
 * `send_page_view: false` because we send `page_view` events manually
 * from `<RouteChangeTracker>` so SPA navigations are tracked too.
 */
export function GoogleAnalytics({ gtagId }: GoogleAnalyticsProps) {
  if (!gtagId) return null

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${gtagId}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gtagId}', {
  anonymize_ip: true,
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
  send_page_view: false
});
`}
      </Script>
      <Suspense fallback={null}>
        <RouteChangeTracker gtagId={gtagId} />
      </Suspense>
    </>
  )
}
