'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { listTransactions, type NwcTransaction } from '@/lib/client/nwc'

interface TransactionsState {
  data: NwcTransaction[] | null
  loading: boolean
  error: Error | null
}

/**
 * Client-side NWC transaction history for one wallet, fetched directly over the
 * relay with the wallet's connection string — the same path Send / Receive use,
 * so no extra server route is needed. Pass `null` while the connection string
 * is still resolving.
 *
 * `limit` caps how many recent transactions we pull; the detail page slices
 * these into pages locally and derives the balance-over-time chart from the
 * same set, so one fetch powers both surfaces.
 */
export function useNwcTransactions(
  connectionString: string | null,
  limit = 100,
  /** Background refresh interval (ms). Set 0 to disable polling. */
  pollMs = 15_000,
) {
  const [state, setState] = useState<TransactionsState>({
    data: null,
    loading: false,
    error: null,
  })
  // Monotonic request id so a slow earlier fetch can't clobber a newer one
  // when the connection string changes mid-flight.
  const reqId = useRef(0)

  // `silent` = a background poll: don't flip the loading flag (so the list /
  // refresh spinner doesn't flash every interval) and keep the prior data on
  // a transient failure instead of blanking the feed.
  const load = useCallback(
    async (silent = false) => {
      if (!connectionString) return
      const id = ++reqId.current
      if (!silent) setState(s => ({ ...s, loading: true, error: null }))
      try {
        const txs = await listTransactions(connectionString, { limit })
        if (id === reqId.current) setState({ data: txs, loading: false, error: null })
      } catch (err) {
        if (id === reqId.current) {
          setState(s =>
            silent
              ? s
              : {
                  data: null,
                  loading: false,
                  error:
                    err instanceof Error ? err : new Error('Failed to load transactions'),
                },
          )
        }
      }
    },
    [connectionString, limit],
  )

  // Initial + on-connection-change load.
  useEffect(() => {
    if (!connectionString) {
      setState({ data: null, loading: false, error: null })
      return
    }
    void load()
  }, [connectionString, load])

  // Live polling so the feed (and the balance chart derived from it) stay
  // current while the page is open.
  useEffect(() => {
    if (!connectionString || !pollMs) return
    const interval = setInterval(() => void load(true), pollMs)
    return () => clearInterval(interval)
  }, [connectionString, pollMs, load])

  return { ...state, refetch: () => load() }
}
