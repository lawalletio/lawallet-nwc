import type React from 'react'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { Providers } from './providers'
import { DevBanner } from '@/components/dev-banner'
import { themeBootScript } from '@/lib/client/theme-presets'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'LaWallet NWC',
  description: 'Lightning Addresses for Everyone',
  // Page translators (Chrome/Google Translate) rewrap React-owned text nodes
  // in <font>, so React's next commit throws NotFoundError on insertBefore /
  // removeChild and the wallet crashes on navigation. The wallet ships its own
  // translations instead (lib/client/i18n).
  other: { google: 'notranslate' }
}

export default function RootLayout({
  children
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" translate="no" className="dark" suppressHydrationWarning>
      <head>
        {/* Brand colour before first paint — see themeBootScript. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
      </head>
      <body
        className={`flex h-dvh flex-col overflow-y-auto bg-background ${inter.className}`}
      >
        {/* Visible only outside production (local `next dev`). */}
        {process.env.NODE_ENV !== 'production' && <DevBanner />}
        <Providers>{children}</Providers>
        <SpeedInsights />
      </body>
    </html>
  )
}
