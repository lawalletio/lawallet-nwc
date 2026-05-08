import type React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import { GoogleAnalytics } from '@/components/analytics/google-analytics'
import { getSettings } from '@/lib/settings'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'LaWallet NWC',
  description: 'Lightning Addresses for Everyone',
}

// The Google Tag ID lives in the DB so admins can set it without a redeploy.
// Failures here (no DB at build time, transient outage, etc.) just mean we
// skip the analytics tag — the rest of the layout must keep rendering.
async function loadGtagId(): Promise<string | null> {
  try {
    const settings = await getSettings(['gtag_id'])
    return settings.gtag_id?.trim() || null
  } catch {
    return null
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const gtagId = await loadGtagId()

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`min-h-dvh bg-background ${inter.className}`}>
        <GoogleAnalytics gtagId={gtagId} />
        <Providers
          attribute="class"
          forcedTheme="dark"
          disableTransitionOnChange
        >
          {children}
        </Providers>
      </body>
    </html>
  )
}
