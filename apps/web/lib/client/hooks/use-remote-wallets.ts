'use client'

import { useEffect, useRef } from 'react'
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

/** Shape of `GET /api/remote-wallets/[id]/balance`. */
export interface RemoteWalletBalance {
  balanceSats: number
}

/**
 * Live spendable balance for a single wallet. Pass `null` to skip the
 * fetch entirely (e.g. for REVOKED wallets, which have no live balance) —
 * `useApi(null)` is a no-op that stays in the idle state.
 *
 * Each row calls this independently so balances stream in in parallel,
 * each with its own loading/error state, instead of blocking the whole
 * table on N sequential relay round-trips.
 */
export function useRemoteWalletBalance(id: string | null) {
  return useApi<RemoteWalletBalance>(id ? `/api/remote-wallets/${id}/balance` : null)
}

/**
 * Same as `useRemoteWalletBalance` but polls on a fixed interval so the
 * displayed value stays current without a manual refresh. Used by the
 * Connection Map wallet nodes — combined with `useAnimatedNumber` on
 * the rendering side it gives the "odometer ticking" feel.
 *
 * The interval is paused when `id` is null (skipping balance for
 * REVOKED wallets etc.) so we don't fire pointless requests for
 * wallets that have no live balance.
 *
 * A ref keeps `refetch` always pointing at the latest closure without
 * resubscribing the interval on every render — otherwise setInterval
 * would be torn down + recreated each render of the consumer.
 */
export function useLiveRemoteWalletBalance(
  id: string | null,
  opts?: { pollMs?: number },
) {
  const pollMs = opts?.pollMs ?? 15_000
  const result = useRemoteWalletBalance(id)
  // Mirror `refetch` into a ref via a post-commit effect so the
  // interval below reads the latest closure without depending on it
  // (which would tear down + re-create the interval every render).
  // Assigning the ref directly during render trips the
  // react-hooks/immutability lint rule.
  const refetchRef = useRef(result.refetch)
  useEffect(() => {
    refetchRef.current = result.refetch
  }, [result.refetch])

  useEffect(() => {
    if (!id) return
    const handle = setInterval(() => {
      refetchRef.current()
    }, pollMs)
    return () => clearInterval(handle)
  }, [id, pollMs])

  return result
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

    /** Rename a wallet. Server enforces the `(userId, name)` unique index. */
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
     * Flip a wallet between ACTIVE and DISABLED. A disabled wallet stays
     * in the list (so it's re-enableable) but shouldn't be selected for
     * new payment routes. REVOKED is terminal and not reachable here —
     * callers gate the affordance on the current status.
     */
    setStatus: async (id: string, status: 'ACTIVE' | 'DISABLED') => {
      const updated = await update.mutate(
        'patch',
        `/api/remote-wallets/${id}`,
        { status },
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
