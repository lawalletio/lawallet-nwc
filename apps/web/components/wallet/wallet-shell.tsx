'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/admin/auth-context'
import { WalletLoadingScreen } from '@/components/wallet/wallet-loading-screen'
import { useFirstLoadProgress } from '@/components/pwa/first-load-progress'

/**
 * Authenticated wrapper for `/wallet/(app)/*` routes.
 *
 * - Redirects unauthenticated users to `/wallet/login` (not the marketing
 *   landing — wallet users shouldn't see the marketing hero mid-logout).
 * - Renders a branded loading screen while auth hydrates so children never
 *   mount with `pubkey === null`.
 * - Provides a mobile-first centered column. Per-screen chrome (headers,
 *   tabbar) is composed inside the children from `components/wallet/shared/*`
 *   so flow screens (send/receive steps) can opt out of the tabbar.
 */
export function WalletShell({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()
  const { report } = useFirstLoadProgress()

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/wallet/landing')
    if (status === 'authenticated') report('auth')
  }, [status, router, report])

  if (status !== 'authenticated') {
    return <WalletLoadingScreen />
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}
