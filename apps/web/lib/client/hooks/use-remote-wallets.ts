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
 * Body shape for `PATCH /api/remote-wallets/[id]`. Server-side schema
 * requires at least one field — passing an empty object will 400 — so
 * the per-action helpers below always populate something.
 */
export interface UpdateRemoteWalletInput {
  name?: string
  isDefault?: boolean
  status?: RemoteWalletData['status']
}

/**
 * Mutations for Remote Wallets. Each helper hits the matching REST verb
 * and then invalidates the cached list path so any mounted
 * `useRemoteWallets` refetches on the next render. The invalidation
 * bridges the gap until a `remote-wallets:updated` SSE event is wired
 * into `getEventTypeForPath`.
 */
export function useRemoteWalletMutations() {
  const create = useMutation<CreateRemoteWalletInput, RemoteWalletData>()
  const update = useMutation<UpdateRemoteWalletInput, RemoteWalletData>()
  const remove = useMutation<void, void>()

  return {
    createWallet: async (input: CreateRemoteWalletInput) => {
      const created = await create.mutate('post', '/api/remote-wallets', input)
      invalidateApiPath('/api/remote-wallets')
      return created
    },

    /**
     * Mark a wallet as the user's default ("primary"). Server clears any
     * prior default in the same transaction.
     */
    setPrimary: async (id: string) => {
      const updated = await update.mutate(
        'patch',
        `/api/remote-wallets/${id}`,
        { isDefault: true },
      )
      invalidateApiPath('/api/remote-wallets')
      return updated
    },

    /**
     * Rename — exists for future use by an inline-edit UI. Kept here so
     * every mutation lives next to `setPrimary` and `deleteWallet`.
     */
    renameWallet: async (id: string, name: string) => {
      const updated = await update.mutate(
        'patch',
        `/api/remote-wallets/${id}`,
        { name },
      )
      invalidateApiPath('/api/remote-wallets')
      return updated
    },

    /**
     * Soft-delete. Server flips `status → REVOKED` and clears
     * `isDefault`. The wallet vanishes from the default list (which
     * excludes REVOKED) but the row stays for audit.
     */
    deleteWallet: async (id: string) => {
      await remove.mutate('del', `/api/remote-wallets/${id}`)
      invalidateApiPath('/api/remote-wallets')
    },

    /** Aggregate spinner — true while ANY of the three helpers is in flight. */
    loading: create.loading || update.loading || remove.loading,
    error: create.error || update.error || remove.error,
  }
}
