'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { CURRENCY_CATALOG, type Currency } from '@/lib/client/currencies-store'
import type { BtcRates } from '@/lib/client/use-yadio-ticker'

export const FIXED_PRICE_CURRENCY_CATALOG: Currency[] = CURRENCY_CATALOG.filter(
  c => c.code !== 'BTC',
)

export interface FixedPrice {
  amount: string
  currency: string
}

const STORAGE_KEY_PREFIX = 'lawallet-fixed-price:'
const cache = new Map<string, FixedPrice | null>()
const listeners = new Set<() => void>()

function storageKey(username: string) {
  return `${STORAGE_KEY_PREFIX}${username.trim().toLowerCase()}`
}

function parseFixedPrice(value: unknown): FixedPrice | null {
  if (!value || typeof value !== 'object') return null
  const { amount, currency } = value as Record<string, unknown>
  if (typeof amount !== 'string' || typeof currency !== 'string') return null
  if (!FIXED_PRICE_CURRENCY_CATALOG.some(item => item.code === currency)) return null
  if (!isValidFixedPriceAmount(amount, currency)) return null
  return { amount: amount.trim(), currency }
}

export function readFixedPrice(username: string): FixedPrice | null {
  const key = storageKey(username)
  if (cache.has(key)) return cache.get(key) ?? null
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(key)
    const fixedPrice = raw ? parseFixedPrice(JSON.parse(raw)) : null
    cache.set(key, fixedPrice)
    return fixedPrice
  } catch {
    cache.set(key, null)
    return null
  }
}

export function saveFixedPrice(username: string, fixedPrice: FixedPrice | null) {
  const key = storageKey(username)
  const next = fixedPrice ? parseFixedPrice(fixedPrice) : null
  cache.set(key, next)

  if (typeof window !== 'undefined') {
    try {
      if (next) {
        window.localStorage.setItem(key, JSON.stringify(next))
      } else {
        window.localStorage.removeItem(key)
      }
    } catch {
      // Keep the current-session value when localStorage is unavailable.
    }
  }

  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (typeof window !== 'undefined' && listeners.size === 1) {
    window.addEventListener('storage', handleStorage)
  }

  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined' && listeners.size === 0) {
      window.removeEventListener('storage', handleStorage)
    }
  }
}

function handleStorage(event: StorageEvent) {
  if (!event.key?.startsWith(STORAGE_KEY_PREFIX)) return
  cache.delete(event.key)
  for (const listener of listeners) listener()
}

export function useFixedPrice(username: string): FixedPrice | null {
  const getSnapshot = useCallback(() => readFixedPrice(username), [username])
  return useSyncExternalStore(subscribe, getSnapshot, () => null)
}

export function formatFixedPrice(fixedPrice: FixedPrice | null): string | null {
  if (!fixedPrice) return null
  if (fixedPrice.currency === 'SAT') {
    const sats = Number(fixedPrice.amount)
    const label = Number.isFinite(sats)
      ? sats.toLocaleString()
      : fixedPrice.amount
    return `${label} sats`
  }
  return `${fixedPrice.amount} ${fixedPrice.currency}`
}

export function isValidFixedPriceAmount(amount: string, currency: string): boolean {
  const trimmed = amount.trim()
  if (currency === 'SAT') return /^[1-9]\d*$/.test(trimmed)
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/.test(trimmed)) return false
  return Number(trimmed) > 0
}

export function estimateFixedPriceSats(
  amount: string,
  currency: string,
  rates: BtcRates | null,
): number | null {
  const trimmed = amount.trim()
  if (!isValidFixedPriceAmount(trimmed, currency)) return null
  if (currency === 'SAT') return Number(trimmed)

  const rate = rates?.[currency]
  const fiatAmount = Number(trimmed)
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null
  return Math.max(1, Math.round((fiatAmount / rate) * 100_000_000))
}

/** Test-only hook to reset the module-level cache between cases. */
export function __resetFixedPriceCacheForTests() {
  cache.clear()
}
