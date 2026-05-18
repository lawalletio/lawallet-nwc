'use client'

import { invalidateApiPath, useApi, useMutation } from '@/lib/client/hooks/use-api'

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

/**
 * Body shape for `POST /api/remote-wallets`. The `config` is typed loosely
 * so different driver types can plug their own shapes — the server runs
 * each through the matching driver's Zod schema.
 */
export interface CreateRemoteWalletInput {
  name: string
  type: RemoteWalletData['type']
  config: unknown
  isDefault?: boolean
}

/**
 * Mutations for Remote Wallets. Today this exposes `createWallet`; rename /
 * set-default / disable / revoke land here when the `apiClient` grows a
 * `patch` method (currently only `get`/`post`/`put`/`del`).
 *
 * `createWallet` invalidates the cached list path so the next `useApi`
 * hit refetches — bridges the gap until a `remote-wallets:updated` SSE
 * event is wired into `getEventTypeForPath`.
 */
export function useRemoteWalletMutations() {
  const { mutate, loading, error } = useMutation<CreateRemoteWalletInput, RemoteWalletData>()

  return {
    createWallet: async (input: CreateRemoteWalletInput) => {
      const created = await mutate('post', '/api/remote-wallets', input)
      // Invalidate every filter combination of the list path. The cache
      // is keyed by full URL so we walk all cached entries that start
      // with the base path — no need for a separate index.
      invalidateApiPath('/api/remote-wallets')
      return created
    },
    loading,
    error,
  }
}
