'use client'

import { useEffect, useState } from 'react'

const ENDPOINT = 'https://api.yadio.io/exrates/BTC'
const POLL_MS = 60_000
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

/**
 * Reads BTC's price against every fiat Yadio publishes (`/exrates/BTC`).
 * Polls every 60 s and caches the latest payload to localStorage so a
 * remount paints with a stale-but-usable table while the next fetch runs.
 *
 * Yadio's CORS headers allow direct browser calls — no backend proxy.
 */
export function useYadioRates(): TickerState {
  const [state, setState] = useState<TickerState>(() => {
    const cached = typeof window !== 'undefined' ? readCache() : null
    return {
      rates: cached?.rates ?? null,
      btcUsd: cached?.rates?.USD ?? null,
      fetchedAt: cached?.fetchedAt ?? null,
      loading: cached === null,
      error: null,
    }
  })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function fetchRates() {
      try {
        const res = await fetch(ENDPOINT, {
          headers: { accept: 'application/json' },
        })
        if (!res.ok) throw new Error(`Yadio responded ${res.status}`)
        // Shape: `{ BTC: { USD: 76262, EUR: 70000, … }, base, timestamp }`.
        const json = (await res.json()) as { BTC?: BtcRates }
        if (cancelled) return
        const rates = json.BTC
        if (!rates || typeof rates.USD !== 'number') {
          throw new Error('Missing rates payload')
        }
        const fetchedAt = Date.now()
        setState({
          rates,
          btcUsd: rates.USD,
          fetchedAt,
          loading: false,
          error: null,
        })
        writeCache({ rates, fetchedAt })
      } catch (err) {
        if (cancelled) return
        setState(prev => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err : new Error('Ticker error'),
        }))
      } finally {
        if (!cancelled) {
          timer = setTimeout(fetchRates, POLL_MS)
        }
      }
    }

    fetchRates()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  return state
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
  rates: BtcRates | null,
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
        fetchedAt: parsed.fetchedAt,
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
