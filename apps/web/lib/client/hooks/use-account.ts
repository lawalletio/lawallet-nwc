'use client'

import {
  invalidateApiPath,
  useApi,
  useMutation
} from '@/lib/client/hooks/use-api'
import { useAuth } from '@/components/admin/auth-context'
import type {
  AccountSummaryResponse,
  NostrIdentitySummary
} from '@/lib/validation/schemas'

const ACCOUNT_PATH = '/api/account'

/**
 * The caller's account summary (identities + passkeys + custody flags) and
 * identity mutations for the Account Settings page. Setting a new primary
 * re-mints the session token afterwards so `useAuth().pubkey` presents the
 * new identity without a re-login.
 */
export function useAccount() {
  const { status, refreshSession } = useAuth()
  const { data, loading, error, refetch } = useApi<AccountSummaryResponse>(
    status === 'authenticated' ? ACCOUNT_PATH : null
  )

  const update = useMutation<
    { isPrimary?: true; label?: string | null },
    NostrIdentitySummary
  >()
  const unlink = useMutation<undefined, { message: string; pubkey: string }>()

  return {
    account: data ?? null,
    identities: data?.identities ?? [],
    credentials: data?.credentials ?? [],
    hasManagedKey: data?.hasManagedKey ?? false,
    managedKeyExported: data?.managedKeyExported ?? false,
    loading,
    error,
    refetch,
    setPrimary: async (pubkey: string) => {
      await update.mutate('patch', `${ACCOUNT_PATH}/identities/${pubkey}`, {
        isPrimary: true
      })
      invalidateApiPath(ACCOUNT_PATH)
      // The session should present the new primary; a failure here is
      // non-fatal (the old token still authenticates the same account).
      await refreshSession().catch(() => false)
    },
    renameIdentity: async (pubkey: string, label: string | null) => {
      await update.mutate('patch', `${ACCOUNT_PATH}/identities/${pubkey}`, {
        label
      })
      invalidateApiPath(ACCOUNT_PATH)
    },
    unlinkIdentity: async (pubkey: string) => {
      await unlink.mutate('del', `${ACCOUNT_PATH}/identities/${pubkey}`)
      invalidateApiPath(ACCOUNT_PATH)
    },
    updating: update.loading,
    unlinking: unlink.loading
  }
}
