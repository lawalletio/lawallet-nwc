'use client'

import { useApi, useMutation as useApiMutation } from '@/lib/client/hooks/use-api'
import type { Role } from '@/lib/auth/permissions'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'

export interface AdminUser {
  id: string
  pubkey: string
  role: Role
  createdAt: string
  /** Username of the user's primary lightning address, or null if none. */
  primaryAddress: string | null
  /** Total number of lightning addresses this user owns. */
  addressCount: number
  /** True if the user has at least one usable (non-revoked) RemoteWallet. */
  hasNwc: boolean
}

export interface AdminUserDetail {
  id: string
  pubkey: string
  role: Role
  createdAt: string
  /** The user's preferred Nostr relays (empty when none set). */
  relays: string[]
  addresses: WalletAddress[]
  transactions: {
    total: number
    paid: number
    paidSats: number
  }
}

/** GET /api/users — admin list of all users. */
export function useUsers() {
  return useApi<AdminUser[]>('/api/users')
}

/** GET /api/users/[userId] — full detail for a single user. */
export function useUser(userId: string | null) {
  return useApi<AdminUserDetail>(
    userId ? `/api/users/${encodeURIComponent(userId)}` : null,
  )
}

/**
 * Mutation hooks for user administration. Currently just role changes; more
 * can be added alongside without churning the import surface.
 */
export function useUserMutations() {
  const { mutate, loading, error } = useApiMutation<
    { role?: Role; relays?: string[] },
    { userId: string; role: Role } | { userId: string; relays: string[] }
  >()
  return {
    updateUserRole: (userId: string, role: Role) =>
      mutate('put', `/api/users/${encodeURIComponent(userId)}/role`, { role }),
    /** Owner-only: replace the user's preferred Nostr relays. */
    updateUserRelays: (userId: string, relays: string[]) =>
      mutate('put', `/api/users/${encodeURIComponent(userId)}/relays`, { relays }),
    loading,
    error,
  }
}
