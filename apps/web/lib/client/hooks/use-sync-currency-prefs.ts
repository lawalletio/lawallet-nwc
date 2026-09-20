'use client'

import { useEffect } from 'react'
import { useAuth } from '@/components/admin/auth-context'
import { useApi } from '@/lib/client/hooks/use-api'
import {
  hydrateCurrencyPrefs,
  setCurrencyPrefsPersister,
  type CurrencyPrefs
} from '@/lib/client/currencies-store'

type MeResponse = {
  currencyPrefs: CurrencyPrefs | null
}

export function useSyncCurrencyPrefs(): void {
  const { status, apiClient } = useAuth()
  const { data } = useApi<MeResponse>('/api/users/me')

  useEffect(() => {
    if (!data?.currencyPrefs) return
    hydrateCurrencyPrefs(data.currencyPrefs)
  }, [data])

  useEffect(() => {
    if (status !== 'authenticated') {
      setCurrencyPrefsPersister(null)
      return
    }

    setCurrencyPrefsPersister(prefs => {
      void apiClient.put('/api/users/me', { currencyPrefs: prefs })
    })

    return () => setCurrencyPrefsPersister(null)
  }, [apiClient, status])
}
