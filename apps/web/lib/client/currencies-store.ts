'use client'

import { useSyncExternalStore } from 'react'
import {
  CURRENCY_CODES,
  type CurrencyCode
} from '@lawallet-nwc/shared/src/currencies'

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
const CATALOG_META = {
  SAT: { name: 'Satoshi', locked: true },
  BTC: { name: 'Bitcoin' },
  ARS: { name: 'Peso Argentino' },
  BRL: { name: 'Real' },
  CLP: { name: 'Peso Chileno' },
  COP: { name: 'Peso Colombiano' },
  EUR: { name: 'Euro' },
  GBP: { name: 'Libra Esterlina' },
  JPY: { name: 'Yen' },
  MXN: { name: 'Peso Mexicano' },
  PEN: { name: 'Sol' },
  USD: { name: 'Dolar Americano' },
  UYU: { name: 'Peso Uruguayo' },
  VES: { name: 'Bolívar' }
} as const satisfies Record<CurrencyCode, { name: string; locked?: boolean }>

export const CURRENCY_CATALOG: Currency[] = CURRENCY_CODES.map(code => {
  const meta = CATALOG_META[code]
  return 'locked' in meta && meta.locked
    ? { code, name: meta.name, locked: true }
    : { code, name: meta.name }
})

const STORAGE_KEY = 'lawallet-active-currencies'
const DEFAULT_ACTIVE: readonly string[] = ['SAT', 'BTC']
const DEFAULT_SELECTED = 'SAT'
const LOCKED_CODES = new Set(
  CURRENCY_CATALOG.filter(c => c.locked).map(c => c.code)
)

export type CurrencyPrefs = {
  active: string[]
  selected: string
}

let cache: CurrencyPrefs | null = null
const listeners = new Set<() => void>()
let persister: ((prefs: CurrencyPrefs) => void) | null = null
let dirty = false

export function setCurrencyPrefsPersister(
  next: ((prefs: CurrencyPrefs) => void) | null
): void {
  persister = next
}

function ensureLocked(list: string[]): string[] {
  const locked: string[] = []
  for (const c of CURRENCY_CATALOG) {
    if (c.locked) locked.push(c.code)
  }
  const seen = new Set<string>(locked)
  const rest: string[] = []
  for (const code of list) {
    if (typeof code !== 'string' || seen.has(code)) continue
    if (!CURRENCY_CATALOG.some(c => c.code === code)) continue
    seen.add(code)
    rest.push(code)
  }
  return [...locked, ...rest]
}

function normalize(active: string[], selected: string): CurrencyPrefs {
  const nextActive = ensureLocked(Array.isArray(active) ? active : [])
  const nextSelected = nextActive.includes(selected)
    ? selected
    : (nextActive[0] ?? DEFAULT_SELECTED)
  return { active: nextActive, selected: nextSelected }
}

function parseStored(raw: string | null): CurrencyPrefs | null {
  if (!raw) return null
  const parsed = JSON.parse(raw) as unknown
  if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
    return normalize(parsed, DEFAULT_SELECTED)
  }
  if (
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as CurrencyPrefs).active) &&
    (parsed as CurrencyPrefs).active.every(item => typeof item === 'string') &&
    typeof (parsed as CurrencyPrefs).selected === 'string'
  ) {
    const prefs = parsed as CurrencyPrefs
    return normalize(prefs.active, prefs.selected)
  }
  return null
}

function defaultPrefs(): CurrencyPrefs {
  return normalize([...DEFAULT_ACTIVE], DEFAULT_SELECTED)
}

function readState(): CurrencyPrefs {
  if (typeof window === 'undefined') return defaultPrefs()
  if (cache) return cache
  try {
    cache =
      parseStored(window.localStorage.getItem(STORAGE_KEY)) ?? defaultPrefs()
  } catch {
    cache = defaultPrefs()
  }
  return cache
}

function read(): string[] {
  return readState().active
}

function readSelected(): string {
  return readState().selected
}

function write(next: CurrencyPrefs, options: { persist?: boolean } = {}) {
  cache = normalize(next.active, next.selected)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
    } catch {
      // ignore quota errors
    }
  }
  if (options.persist !== false) {
    dirty = true
    persister?.(cache)
  } else {
    dirty = false
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
  const codes = useSyncExternalStore(subscribe, read, () => DEFAULT_ACTIVE)
  const out: Currency[] = []
  for (const code of codes) {
    const match = CURRENCY_CATALOG.find(c => c.code === code)
    if (match) out.push(match)
  }
  return out
}

/** Hook returning the persisted display currency ticker. */
export function useSelectedCurrencyCode(): string {
  return useSyncExternalStore(subscribe, readSelected, () => DEFAULT_SELECTED)
}

/**
 * Mutation surface for the currencies store. All writes go through these to
 * keep the locked-codes invariant ({@link CURRENCY_CATALOG} entries with
 * `locked: true` always remain at the front of the list).
 */
export const currenciesActions = {
  add(code: string) {
    if (!CURRENCY_CATALOG.some(c => c.code === code)) return
    const current = readState()
    if (current.active.includes(code)) return
    write({ active: [...current.active, code], selected: current.selected })
  },
  remove(code: string) {
    if (LOCKED_CODES.has(code)) return
    const current = readState()
    write({
      active: current.active.filter(item => item !== code),
      selected: current.selected
    })
  },
  reorder(nextOrder: string[]) {
    const seen = new Set<string>()
    const safe: string[] = []
    for (const code of nextOrder) {
      if (seen.has(code)) continue
      if (!CURRENCY_CATALOG.some(c => c.code === code)) continue
      seen.add(code)
      safe.push(code)
    }
    write({ active: safe, selected: readState().selected })
  },
  select(code: string) {
    const current = readState()
    if (!current.active.includes(code)) return
    if (current.selected === code) return
    write({ active: current.active, selected: code })
  }
}

export function readCurrencyPrefs(): CurrencyPrefs {
  return readState()
}

export function isCurrencyPrefsDirty(): boolean {
  return dirty
}

export function hydrateCurrencyPrefs(prefs: CurrencyPrefs): void {
  if (
    !prefs ||
    !Array.isArray(prefs.active) ||
    typeof prefs.selected !== 'string'
  ) {
    return
  }
  write(prefs, { persist: false })
}

/**
 * Restores account-scoped display preferences to their defaults on logout.
 * Subscribers are notified so a still-mounted wallet shell cannot retain the
 * previous account's selected currencies for a frame.
 */
export function clearCurrencyPreferences(): void {
  cache = defaultPrefs()
  dirty = false
  persister = null
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore unavailable storage
    }
  }
  for (const listener of listeners) listener()
}

/** Test-only hook to drop the in-memory cache between cases. */
export function __resetCurrenciesCacheForTests() {
  cache = null
  dirty = false
  persister = null
}
