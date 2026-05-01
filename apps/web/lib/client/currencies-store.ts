'use client'

import { useSyncExternalStore } from 'react'

export interface Currency {
  /** 3-letter ticker (`SAT`, `BTC`, ISO 4217 fiat code). */
  code: string
  /** Display name shown in the settings list (`Satoshi`, `Dolar Americano`). */
  name: string
  /**
   * When true, the entry is permanently in the active list and the UI
   * disables the remove control. We lock SAT because it's the underlying
   * unit of every balance in the app — every other code is a display
   * conversion of the same sats number.
   */
  locked?: boolean
}

/**
 * Static list of currencies the wallet knows how to display. Codes here
 * must also be present as keys under `BTC.<code>` in Yadio's
 * `/exrates/BTC` response — `useYadioRates` looks them up directly.
 *
 * Order is the default sort for the "Available References" list on the
 * Currencies settings screen. Add new codes alphabetically inside their
 * group to keep that list stable.
 */
export const CURRENCY_CATALOG: Currency[] = [
  // Crypto / native units
  { code: 'SAT', name: 'Satoshi', locked: true },
  { code: 'BTC', name: 'Bitcoin' },
  // Fiat (LATAM-leaning since LaWallet's primary communities are Spanish-speaking)
  { code: 'ARS', name: 'Peso Argentino' },
  { code: 'BRL', name: 'Real' },
  { code: 'CLP', name: 'Peso Chileno' },
  { code: 'COP', name: 'Peso Colombiano' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'Libra Esterlina' },
  { code: 'JPY', name: 'Yen' },
  { code: 'MXN', name: 'Peso Mexicano' },
  { code: 'PEN', name: 'Sol' },
  { code: 'USD', name: 'Dolar Americano' },
  { code: 'UYU', name: 'Peso Uruguayo' },
  { code: 'VES', name: 'Bolívar' },
]

const STORAGE_KEY = 'lawallet-active-currencies'
const DEFAULT_ACTIVE: readonly string[] = ['SAT', 'BTC']
const LOCKED_CODES = new Set(
  CURRENCY_CATALOG.filter(c => c.locked).map(c => c.code),
)

let cache: string[] | null = null
const listeners = new Set<() => void>()

function ensureLocked(list: string[]): string[] {
  // Always keep locked codes (currently just SAT) at the front of the
  // active list, even if a malformed localStorage payload removed them.
  const locked: string[] = []
  for (const c of CURRENCY_CATALOG) {
    if (c.locked) locked.push(c.code)
  }
  const rest = list.filter(c => !LOCKED_CODES.has(c))
  return [...locked, ...rest]
}

function read(): string[] {
  if (typeof window === 'undefined') return [...DEFAULT_ACTIVE]
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every(s => typeof s === 'string')) {
        cache = ensureLocked(parsed)
        return cache
      }
    }
  } catch {
    // fall through
  }
  cache = ensureLocked([...DEFAULT_ACTIVE])
  return cache
}

function write(next: string[]) {
  cache = ensureLocked(next)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    } catch {
      // ignore quota errors
    }
  }
  for (const fn of listeners) fn()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  if (typeof window !== 'undefined' && listeners.size === 1) {
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(fn)
    if (typeof window !== 'undefined' && listeners.size === 0) {
      window.removeEventListener('storage', onStorage)
    }
  }
}

function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY) return
  cache = null
  for (const fn of listeners) fn()
}

/** Hook returning the currently active currencies in display order. */
export function useActiveCurrencies(): Currency[] {
  const codes = useSyncExternalStore(subscribe, read, () => [
    ...DEFAULT_ACTIVE,
  ])
  const out: Currency[] = []
  for (const code of codes) {
    const match = CURRENCY_CATALOG.find(c => c.code === code)
    if (match) out.push(match)
  }
  return out
}

/**
 * Mutation surface for the currencies store. All writes go through these to
 * keep the locked-codes invariant ({@link CURRENCY_CATALOG} entries with
 * `locked: true` always remain at the front of the list).
 */
export const currenciesActions = {
  add(code: string) {
    if (!CURRENCY_CATALOG.some(c => c.code === code)) return
    const current = read()
    if (current.includes(code)) return
    write([...current, code])
  },
  remove(code: string) {
    if (LOCKED_CODES.has(code)) return
    write(read().filter(c => c !== code))
  },
  reorder(nextOrder: string[]) {
    // Only accept codes that exist in the catalog and dedupe.
    const seen = new Set<string>()
    const safe: string[] = []
    for (const code of nextOrder) {
      if (seen.has(code)) continue
      if (!CURRENCY_CATALOG.some(c => c.code === code)) continue
      seen.add(code)
      safe.push(code)
    }
    write(safe)
  },
}

/** Test-only hook to drop the in-memory cache between cases. */
export function __resetCurrenciesCacheForTests() {
  cache = null
}
