'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/admin/auth-context'
import { Spinner } from '@/components/ui/spinner'

/**
 * Authenticated wrapper for `/wallet/(app)/*` routes.
 *
 * - Redirects unauthenticated users to `/wallet/login` (not the marketing
 *   landing — wallet users shouldn't see the marketing hero mid-logout).
 * - Renders a loading spinner while auth hydrates so children never mount
 *   with `pubkey === null`.
 * - Provides a mobile-first centered column. Per-screen chrome (headers,
 *   tabbar) is composed inside the children from `components/wallet/shared/*`
 *   so flow screens (send/receive steps) can opt out of the tabbar.
 */
export function WalletShell({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/wallet/landing')
  }, [status, router])

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Spinner size={24} />
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        {children}
      </div>
    </div>
  )
}
