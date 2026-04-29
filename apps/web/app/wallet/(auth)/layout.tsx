'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/admin/auth-context'
import { Spinner } from '@/components/ui/spinner'

/**
 * Public layout for `/wallet/login`, `/wallet/create-account`, etc.
 * Users who are already authenticated get bounced to `/wallet` so they
 * don't see the login screen after a signer restore. Post-signup
 * confirmations live under `(app)/welcome` instead of here so they don't
 * race this redirect.
 */
export default function WalletAuthLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()

  React.useEffect(() => {
    if (status !== 'authenticated') return
    // Defer the redirect one tick so a caller that just logged in (e.g.
    // the create-account flow) can run its own `router.replace` to a
    // post-signup destination first. If they do, this layout unmounts and
    // the cleanup below cancels the default bounce.
    const t = setTimeout(() => router.replace('/wallet'), 100)
    return () => clearTimeout(t)
  }, [status, router])

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Spinner size={24} />
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-6">
        {children}
      </div>
    </div>
  )
}
