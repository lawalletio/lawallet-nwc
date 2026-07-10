import type React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import { GoogleAnalytics } from '@/components/analytics/google-analytics'
import { DevBanner } from '@/components/dev-banner'
import { getSettings } from '@/lib/settings'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'LaWallet NWC',
  description: 'Lightning Addresses for Everyone'
}

// The Google Tag ID lives in the DB so admins can set it without a redeploy.
// Failures here (transient outage, etc.) just mean we skip the analytics tag —
// the rest of the layout must keep rendering.
async function loadGtagId(): Promise<string | null> {
  // `next build` prerenders this layout with no DB reachable. Skip the query
  // outright during the build phase so it doesn't spam connection errors into
  // the build log — the real value is fetched per-request at runtime.
  if (process.env.NEXT_PHASE === 'phase-production-build') return null
  try {
    const settings = await getSettings(['gtag_id'])
    return settings.gtag_id?.trim() || null
  } catch {
    return null
  }
}

export default async function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  const gtagId = await loadGtagId()

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`flex h-dvh flex-col overflow-y-auto bg-background ${inter.className}`}
      >
        {/* Visible only outside production (local `next dev`). */}
        {process.env.NODE_ENV !== 'production' && <DevBanner />}
        <GoogleAnalytics gtagId={gtagId} />
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
