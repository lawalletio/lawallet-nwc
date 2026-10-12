'use client'

import { useSyncExternalStore } from 'react'

const ENDPOINT = 'https://api.yadio.io/exrates/BTC'
/** Rates younger than this are reused instead of refetched. */
const TTL_MS = 60_000
const FETCH_TIMEOUT_MS = 10_000
const STORAGE_KEY = 'lawallet-yadio-rates'

/** BTC priced in each fiat currency, keyed by 3-letter code. */
export type BtcRates = Record<string, number>

interface TickerState {
  /** Full rate table. `null` until the first successful fetch. */
  rates: BtcRates | null
  /** Convenience accessor for the USD rate, since most call sites need it. */
  btcUsd: number | null
  fetchedAt: number | null
  loading: boolean
  error: Error | null
}

// ─── Module-level shared store ─────────────────────────────────────────────
// Every consumer used to run its own fetch + 60 s loop, so one wallet screen
// with a few amount widgets fanned out into several Yadio calls per minute.
// Now one store serves them all: one in-flight request at a time, refetched
// only once the table is older than `TTL_MS`, and never while hidden.

const SERVER_STATE: TickerState = {
  rates: null,
  btcUsd: null,
  fetchedAt: null,
  loading: true,
  error: null
}

let state: TickerState | null = null
const listeners = new Set<() => void>()
let inflight: Promise<void> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

function getState(): TickerState {
  if (!state) {
    const cached = readCache()
    state = {
      rates: cached?.rates ?? null,
      btcUsd: cached?.rates.USD ?? null,
      fetchedAt: cached?.fetchedAt ?? null,
      loading: cached === null,
      error: null
    }
  }
  return state
}

function setState(next: TickerState) {
  state = next
  for (const listener of listeners) listener()
}

/** Fetches unless the table is fresh, a request is in flight or the tab is hidden. */
export function refreshYadioRates(): Promise<void> {
  if (inflight) return inflight
  const { fetchedAt } = getState()
  if (document.hidden) return Promise.resolve()
  if (fetchedAt !== null && Date.now() - fetchedAt < TTL_MS) {
    return Promise.resolve()
  }
  inflight = (async () => {
    try {
      const res = await fetch(ENDPOINT, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
      })
      if (!res.ok) throw new Error(`Yadio responded ${res.status}`)
      // Shape: `{ BTC: { USD: 76262, EUR: 70000, … }, base, timestamp }`.
      const json = (await res.json()) as { BTC?: BtcRates }
      const rates = json.BTC
      if (!rates || typeof rates.USD !== 'number') {
        throw new Error('Missing rates payload')
      }
      const now = Date.now()
      setState({
        rates,
        btcUsd: rates.USD,
        fetchedAt: now,
        loading: false,
        error: null
      })
      writeCache({ rates, fetchedAt: now })
    } catch (err) {
      setState({
        ...getState(),
        loading: false,
        error: err instanceof Error ? err : new Error('Ticker error')
      })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

function onVisibilityChange() {
  void refreshYadioRates()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshYadioRates()
    // Ticks are cheap no-ops until the TTL lapses.
    pollTimer = setInterval(() => void refreshYadioRates(), TTL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }
}

/** Test-only: drop the shared state so each test starts cold. */
export function __resetYadioStore() {
  state = null
  inflight = null
}

/**
 * Reads BTC's price against every fiat Yadio publishes (`/exrates/BTC`).
 * Backed by one shared store (see above) that refreshes at most every 60 s
 * and caches the latest payload to localStorage, so a remount or reload
 * paints with a stale-but-usable table while the next fetch runs.
 *
 * Yadio's CORS headers allow direct browser calls — no backend proxy.
 */
export function useYadioRates(): TickerState {
  return useSyncExternalStore(subscribe, getState, () => SERVER_STATE)
}

/**
 * Convert a sats amount to the requested currency. Returns `null` when the
 * fiat rate isn't available yet (caller is expected to render `—` then).
 *
 * `SAT` and `BTC` never need a rate — `SAT` is the source unit, `BTC` is
 * just `sats / 100_000_000`.
 */
export function convertSats(
  sats: number,
  code: string,
  rates: BtcRates | null
): number | null {
  if (code === 'SAT') return sats
  if (code === 'BTC') return sats / 100_000_000
  if (!rates) return null
  const rate = rates[code]
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return null
  return (sats / 100_000_000) * rate
}

/**
 * Back-compat wrapper for legacy call sites that only need the BTC/USD rate.
 * New code should prefer `useYadioRates()` directly.
 */
export function useYadioTicker() {
  const { btcUsd, fetchedAt, loading, error } = useYadioRates()
  return { btcUsd, fetchedAt, loading, error }
}

function readCache(): { rates: BtcRates; fetchedAt: number } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      rates?: unknown
      fetchedAt?: unknown
    }
    if (
      parsed &&
      typeof parsed.fetchedAt === 'number' &&
      parsed.rates &&
      typeof parsed.rates === 'object' &&
      typeof (parsed.rates as BtcRates).USD === 'number'
    ) {
      return {
        rates: parsed.rates as BtcRates,
        fetchedAt: parsed.fetchedAt
      }
    }
    return null
  } catch {
    return null
  }
}

function writeCache(entry: { rates: BtcRates; fetchedAt: number }) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // ignore — quota or disabled storage
  }
}
