'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/admin/auth-context'

// Only the main tabs: the first navigation from home is almost always one of
// these. Deeper settings pages pull heavy chunks (remote-wallets ships the QR
// dialog) and are reached rarely enough to load on demand.
const WALLET_ROUTES = [
  '/wallet',
  '/wallet/activity',
  '/wallet/receive',
  '/wallet/send',
  '/wallet/scan',
  '/wallet/settings'
] as const

/**
 * Prefetches the main wallet tabs once the session is authenticated. Warms
 * both the Next router cache and — in production — the service worker's
 * static cache, so tab switches render without a network round-trip. Skipped
 * when the browser asks to save data. Renders nothing.
 */
export function RoutePrefetcher() {
  const { status } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (status !== 'authenticated') return
    const connection = (
      navigator as Navigator & { connection?: { saveData?: boolean } }
    ).connection
    if (connection?.saveData) return
    for (const route of WALLET_ROUTES) router.prefetch(route)
  }, [status, router])

  return null
}
