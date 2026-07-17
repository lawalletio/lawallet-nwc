'use client'

import { useState } from 'react'
import {
  invalidateApiPath,
  useApi,
  useMutation
} from '@/lib/client/hooks/use-api'
import { useAuth } from '@/components/admin/auth-context'
import {
  linkPasskey,
  translatePasskeyError,
  type PasskeyCredentialSummary
} from '@/lib/client/passkey-api'

const CREDENTIALS_PATH = '/api/auth/passkey/credentials'

interface PasskeyListResponse {
  credentials: PasskeyCredentialSummary[]
  /** True when the server custodies this account's Nostr key (passkey-native). */
  hasManagedKey: boolean
  /** True once the custodied key has been exported — unblocks last-passkey delete. */
  managedKeyExported: boolean
}

/**
 * Passkey management for the security settings screen: list/rename/delete
 * own credentials, link a new one (also the entry point for nsec/extension/
 * bunker users adding their first passkey), and the `hasManagedKey` flag
 * that gates the export-key UI.
 */
export function usePasskeys() {
  const { status, jwt } = useAuth()
  const { data, loading, error, refetch } = useApi<PasskeyListResponse>(
    status === 'authenticated' ? CREDENTIALS_PATH : null
  )

  const rename = useMutation<{ label: string }, { credential: PasskeyCredentialSummary }>()
  const del = useMutation<undefined, { message: string; id: string }>()
  const [adding, setAdding] = useState(false)

  return {
    credentials: data?.credentials ?? [],
    hasManagedKey: data?.hasManagedKey ?? false,
    managedKeyExported: data?.managedKeyExported ?? false,
    loading,
    error,
    refetch,
    /** Runs the full link ceremony — call from a click handler only. */
    addPasskey: async () => {
      if (!jwt) throw new Error('Not signed in')
      setAdding(true)
      try {
        const summary = await linkPasskey(jwt)
        invalidateApiPath(CREDENTIALS_PATH)
        return summary
      } catch (err) {
        throw translatePasskeyError(err)
      } finally {
        setAdding(false)
      }
    },
    renameCredential: async (id: string, label: string) => {
      const result = await rename.mutate(
        'patch',
        `${CREDENTIALS_PATH}/${encodeURIComponent(id)}`,
        { label }
      )
      invalidateApiPath(CREDENTIALS_PATH)
      return result
    },
    deleteCredential: async (id: string) => {
      const result = await del.mutate(
        'del',
        `${CREDENTIALS_PATH}/${encodeURIComponent(id)}`,
        undefined
      )
      invalidateApiPath(CREDENTIALS_PATH)
      return result
    },
    adding,
    renaming: rename.loading,
    deleting: del.loading
  }
}
