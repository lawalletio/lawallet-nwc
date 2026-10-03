'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useAuth } from '@/components/admin/auth-context'
import { useApi } from '@/lib/client/hooks/use-api'
import {
  hydrateCurrencyPrefs,
  isCurrencyPrefsDirty,
  readCurrencyPrefs,
  setCurrencyPrefsPersister,
  type CurrencyPrefs
} from '@/lib/client/currencies-store'

export const CURRENCY_PREFS_PATH = '/api/users/me/currency-prefs'
export const CURRENCY_PREFS_SAVE_DEBOUNCE_MS = 300

type MeResponse = {
  userId?: string
  currencyPrefs: CurrencyPrefs | null
}

type PrefsSaver = (prefs: CurrencyPrefs) => Promise<unknown>

let timer: ReturnType<typeof setTimeout> | null = null
let pending: CurrencyPrefs | null = null
let inflight = false
let generation = 0
let saver: PrefsSaver | null = null

function bindCurrencyPrefsSaver(next: PrefsSaver | null): void {
  saver = next
  if (!next) {
    generation += 1
    return
  }
  if (pending && !inflight && !timer) {
    timer = setTimeout(() => {
      timer = null
      void flushCurrencyPrefsSave()
    }, CURRENCY_PREFS_SAVE_DEBOUNCE_MS)
  }
}

export function queueCurrencyPrefsSave(prefs: CurrencyPrefs): void {
  pending = prefs
  if (inflight) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void flushCurrencyPrefsSave()
  }, CURRENCY_PREFS_SAVE_DEBOUNCE_MS)
}

async function flushCurrencyPrefsSave(): Promise<void> {
  if (inflight || !pending || !saver) return
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const prefs = pending
  const save = saver
  pending = null
  inflight = true
  const id = ++generation
  try {
    await save(prefs)
  } catch (error) {
    if (id === generation) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not save currency preference'
      )
    }
  } finally {
    inflight = false
    if (pending && id === generation) void flushCurrencyPrefsSave()
  }
}

export function __resetCurrencyPrefsSyncForTests(): void {
  if (timer) clearTimeout(timer)
  timer = null
  pending = null
  inflight = false
  saver = null
  generation += 1
}

export function useSyncCurrencyPrefs(): void {
  const { status, apiClient } = useAuth()
  const { data } = useApi<MeResponse>('/api/users/me')
  const hydratedFor = useRef<string | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') {
      bindCurrencyPrefsSaver(null)
      return
    }
    bindCurrencyPrefsSaver(prefs =>
      apiClient.put(CURRENCY_PREFS_PATH, { currencyPrefs: prefs })
    )
  }, [apiClient, status])

  useEffect(() => {
    if (status !== 'authenticated' || !data?.userId) {
      setCurrencyPrefsPersister(null)
      if (status !== 'authenticated') {
        hydratedFor.current = null
        __resetCurrencyPrefsSyncForTests()
      }
      return
    }

    setCurrencyPrefsPersister(queueCurrencyPrefsSave)
    return () => setCurrencyPrefsPersister(null)
  }, [status, data?.userId])

  useEffect(() => {
    if (status !== 'authenticated') return
    const userId = data?.userId
    if (!userId || hydratedFor.current === userId) return
    hydratedFor.current = userId

    if (data.currencyPrefs && !isCurrencyPrefsDirty()) {
      hydrateCurrencyPrefs(data.currencyPrefs)
      return
    }
    queueCurrencyPrefsSave(readCurrencyPrefs())
  }, [status, data])
}
