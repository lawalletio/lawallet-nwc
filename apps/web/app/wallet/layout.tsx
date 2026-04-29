import type React from 'react'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Wallet - LaWallet',
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
