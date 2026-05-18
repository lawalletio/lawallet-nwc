'use client'

import { useApi } from '@/lib/client/hooks/use-api'

/**
 * Wire shape returned by `GET /api/remote-wallets` — kept in lock-step with
 * the `RemoteWalletDto` defined in the route handler. `config` is
 * intentionally **not** in this shape: connection secrets never travel in
 * generic reads, and the UI shouldn't reach for it.
 */
export interface RemoteWalletData {
  id: string
  name: string
  type: 'NWC' | 'LND' | 'CLN' | 'BTCPAY'
  status: 'ACTIVE' | 'DISABLED' | 'REVOKED'
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

/** Optional filters. Mirrors `remoteWalletListQuerySchema`. */
export interface RemoteWalletFilters {
  status?: RemoteWalletData['status']
  type?: RemoteWalletData['type']
}

/**
 * List the authenticated user's Remote Wallets. By default the API hides
 * REVOKED rows; pass `{ status: 'REVOKED' }` to get them. Filters become
 * query params so `useApi`'s URL-based SWR cache keys each combination
 * independently.
 */
export function useRemoteWallets(filters?: RemoteWalletFilters) {
  const params = new URLSearchParams()
  if (filters?.status) params.set('status', filters.status)
  if (filters?.type) params.set('type', filters.type)
  const qs = params.toString()
  const path = qs ? `/api/remote-wallets?${qs}` : '/api/remote-wallets'
  return useApi<RemoteWalletData[]>(path)
}
