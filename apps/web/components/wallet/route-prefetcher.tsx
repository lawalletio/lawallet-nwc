'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/admin/auth-context'

// Wallet routes worth warming so the first navigation is instant. Next dedupes
// prefetches and no-ops in dev, so this is cheap to call eagerly.
const WALLET_ROUTES = [
  '/wallet',
  '/wallet/activity',
  '/wallet/receive',
  '/wallet/send',
  '/wallet/scan',
  '/wallet/settings',
  '/wallet/settings/cards',
  '/wallet/settings/security',
  '/wallet/settings/remote-wallets'
] as const

/**
 * Prefetches every wallet route once the session is authenticated. Warms both
 * the Next router cache and — in production — the service worker's static
 * cache, so tab switches and flow entries render without a network round-trip.
 * Renders nothing.
 */
export function RoutePrefetcher() {
  const { status } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (status !== 'authenticated') return
    for (const route of WALLET_ROUTES) router.prefetch(route)
  }, [status, router])

  return null
}
