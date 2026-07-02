import type React from 'react'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Wallet - LaWallet',
  // Standalone / home-screen install hints. The web manifest (`app/manifest.ts`)
  // carries the full install config; these cover iOS Safari, which ignores the
  // manifest's `display` and relies on apple-specific meta instead.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'LaWallet'
  },
  icons: {
    apple: '/icons/icon-192.png'
  }
}

export const viewport: Viewport = {
  themeColor: '#0a0a0a'
}

/**
 * Thin passthrough — the real layout for authenticated pages lives in
 * `(app)/layout.tsx`, and the public onboarding pages use `(auth)/layout.tsx`.
 * Keeping this file minimal means Next's route-group conventions pick the
 * right shell per branch.
 */
export default function WalletLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
