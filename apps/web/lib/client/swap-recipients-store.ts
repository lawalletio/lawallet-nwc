'use client'

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'lawallet-swap-recipients'
const MAX_RECIPIENTS = 10

/** A bank account the user already paid through a swap (alias lookup shape). */
export interface SwapRecipient {
  cvu: string
  alias: string | null
  bank: string
  icon: string | null
  owners: { type: 'F' | 'J'; cuit: string; name: string }[]
  /** Epoch ms of the last use — most recent first. */
  usedAt: number
}

const EMPTY: SwapRecipient[] = []
let cache: SwapRecipient[] | null = null
const listeners = new Set<() => void>()

function read(): SwapRecipient[] {
  if (typeof window === 'undefined') return EMPTY
  if (cache) return cache
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? '[]'
    ) as SwapRecipient[]
    cache = Array.isArray(parsed) ? parsed.filter(r => r?.cvu) : []
  } catch {
    cache = []
  }
  return cache
}

function write(next: SwapRecipient[]) {
  cache = next.slice(0, MAX_RECIPIENTS)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // quota/private mode — the in-memory list still works this session
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    cache = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Recently paid bank accounts, newest first. Empty during SSR. */
export function useSwapRecipients(): SwapRecipient[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY)
}

export const swapRecipients = {
  /** Remember (or bump) an account, keyed by its CBU/CVU. */
  remember(account: Omit<SwapRecipient, 'usedAt'>) {
    write([
      { ...account, usedAt: Date.now() },
      ...read().filter(r => r.cvu !== account.cvu)
    ])
  },
  forget(cvu: string) {
    write(read().filter(r => r.cvu !== cvu))
  }
}

/** Logout cleanup: these are other people's bank details. */
export function clearSwapRecipients() {
  cache = []
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // unavailable storage
  }
  for (const l of listeners) l()
}
