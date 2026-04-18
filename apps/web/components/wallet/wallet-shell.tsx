'use client'

import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/admin/auth-context'
import { BrandLogotype } from '@/components/ui/brand-logotype'
import { Spinner } from '@/components/ui/spinner'

/**
 * Authenticated chrome for `/wallet/*` pages.
 *
 * Wallet routes are user-facing (any authenticated role) and intentionally
 * skip the admin sidebar. Unauthenticated visitors are sent to the home
 * page where they can sign in. While auth is still loading we render a
 * spinner so children never mount with `pubkey === null`.
 */
export function WalletShell({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  const router = useRouter()

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/')
  }, [status, router])

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner size={24} />
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur-xl sm:px-6">
        <Link href="/wallet" className="flex items-center gap-2">
          <BrandLogotype width={100} height={24} className="h-6 w-auto" />
        </Link>
        <Link
          href="/admin"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Admin
        </Link>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  )
}
