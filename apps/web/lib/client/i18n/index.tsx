'use client'

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useSyncExternalStore
} from 'react'
import en, { type Dict } from './en'
import { setActiveLocale } from './active-locale'

/** Native names, shown as-is in the language picker. */
export const LOCALES = { en: 'English', es: 'Español' } as const
export type Locale = keyof typeof LOCALES
export type { Dict }

export const DEFAULT_LOCALE: Locale = 'en'
const STORAGE_KEY = 'lawallet-locale:v1'

// English ships in the main bundle (default + fallback); every other locale
// is its own chunk, fetched only by users who need it.
const loaders: Record<Exclude<Locale, 'en'>, () => Promise<Dict>> = {
  es: () => import('./es').then(m => m.default)
}
const dicts: Partial<Record<Locale, Dict>> = { en }
const pending = new Map<Locale, Promise<void>>()

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && value in LOCALES
}

/** First of the browser's preferred languages we support, by base subtag. */
export function matchLocale(languages: readonly string[]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

/** The explicit choice from the Language screen; `null` = follow the device. */
function readPreference(): Locale | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return isLocale(raw) ? raw : null
  } catch {
    return null
  }
}

function resolveLocale(): Locale {
  return readPreference() ?? matchLocale(navigator.languages ?? [])
}

function load(locale: Locale): Promise<void> {
  if (dicts[locale]) return Promise.resolve()
  let promise = pending.get(locale)
  if (!promise) {
    promise = loaders[locale as Exclude<Locale, 'en'>]()
      .then(dict => {
        dicts[locale] = dict
      })
      // Chunk unreachable (offline first visit): fall back to English rather
      // than leaving the wallet hidden.
      .catch(() => {
        pending.delete(locale)
        dicts[locale] = en
      })
    pending.set(locale, promise)
  }
  return promise
}

const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && listener()
  window.addEventListener('storage', onStorage)
  window.addEventListener('languagechange', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('languagechange', listener)
  }
}

/** Persists the user's choice; `null` goes back to the device language. */
export function setLocalePreference(locale: Locale | null) {
  try {
    if (locale) localStorage.setItem(STORAGE_KEY, locale)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // private mode / quota: the choice just won't survive a reload
  }
  for (const listener of listeners) listener()
}

export function useLocalePreference(): Locale | null {
  return useSyncExternalStore(subscribe, readPreference, () => null)
}

// Start fetching a non-English dictionary while React is still hydrating, so
// it's usually ready by the time the provider first asks for it.
if (typeof window !== 'undefined') void load(resolveLocale())

const I18nContext = createContext<{ locale: Locale; t: Dict }>({
  locale: DEFAULT_LOCALE,
  t: en
})

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Server and hydration render English; the client snapshot swaps in the
  // resolved locale synchronously before first paint.
  const locale = useSyncExternalStore(
    subscribe,
    resolveLocale,
    () => DEFAULT_LOCALE
  )
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const dict = dicts[locale]
  // Set during render so children formatting dates in this same pass see it.
  setActiveLocale(dict ? locale : DEFAULT_LOCALE)
  useEffect(() => () => setActiveLocale(DEFAULT_LOCALE), [])

  useEffect(() => {
    document.documentElement.lang = locale
    if (!dict) void load(locale).then(rerender)
  }, [locale, dict])

  const value = useMemo(() => ({ locale, t: dict ?? en }), [locale, dict])

  // While a dictionary loads, keep the tree mounted (no NWC reconnects) but
  // hidden, so nobody sees English flash into Spanish.
  return (
    <I18nContext.Provider value={value}>
      <div
        style={{ display: 'contents', visibility: dict ? undefined : 'hidden' }}
      >
        {children}
      </div>
    </I18nContext.Provider>
  )
}

/** The active dictionary: `t.settings.title`, `t.send.sentTo(name)`. */
export function useT(): Dict {
  return useContext(I18nContext).t
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale
}
