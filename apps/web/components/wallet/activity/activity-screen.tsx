'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '@/lib/client/hooks/use-api'
import { useNwcBalance } from '@/lib/client/use-nwc-balance'
import { listTransactions, type NwcTransaction } from '@/lib/client/nwc'
import { nwcCacheKey } from '@/lib/client/cache/key'
import {
  readRecent,
  upsertMany,
} from '@/lib/client/cache/activity-cache'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import { NavTabbar } from '@/components/wallet/shared/nav-tabbar'
import { TransactionRow } from '@/components/wallet/shared/transaction-row'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

const PAGE_SIZE = 25

interface UserMeResponse {
  effectiveNwcString: string | null
}

export function ActivityScreen() {
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const nwcString = me?.effectiveNwcString ?? null

  // Reuse the existing balance subscription so an inbound payment refreshes
  // the list in real-time without spinning up a second relay connection.
  const [refreshKey, setRefreshKey] = useState(0)
  useNwcBalance(nwcString, {
    onTransaction: () => setRefreshKey(k => k + 1),
  })

  const [transactions, setTransactions] = useState<NwcTransaction[]>([])
  const [loadingInitial, setLoadingInitial] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [tab, setTab] = useState<'all' | 'transfers'>('all')

  // Latest in-flight fetch token. Each fetch increments this so a stale
  // response (e.g. user changed wallets mid-flight) can be discarded.
  const fetchIdRef = useRef(0)
  // Guard double-fires from the IntersectionObserver while a request is
  // already in flight — `loadingMore` state isn't enough on its own
  // because state updates are async.
  const fetchingRef = useRef(false)

  // Initial / refresh fetch — hydrate from the IDB cache first so the
  // list paints instantly, then fire the live fetch in parallel and
  // merge results back into both state and storage.
  useEffect(() => {
    if (!nwcString) {
      setTransactions([])
      setHasMore(false)
      setError(null)
      setLoadingInitial(false)
      return
    }
    const id = ++fetchIdRef.current
    let cancelled = false
    fetchingRef.current = true
    setLoadingInitial(true)
    setError(null)

    const cacheKey = nwcCacheKey(nwcString)

    // Cache hydration runs in parallel with the network fetch. Whichever
    // resolves first paints; cache hits typically win the race.
    readRecent(cacheKey, PAGE_SIZE).then(cached => {
      if (cancelled || id !== fetchIdRef.current) return
      if (cached.length > 0) {
        setTransactions(prev => mergeNewerFirst(prev, cached))
        // Don't promise we have more cached pages — only the live fetch
        // can confirm that. Keep `hasMore` as-is until the network
        // response arrives.
      }
    })

    listTransactions(nwcString, { limit: PAGE_SIZE })
      .then(list => {
        if (cancelled || id !== fetchIdRef.current) return
        setTransactions(prev => mergeNewerFirst(prev, list))
        setHasMore(list.length >= PAGE_SIZE)
        upsertMany(cacheKey, list)
      })
      .catch(err => {
        if (cancelled || id !== fetchIdRef.current) return
        setError(err instanceof Error ? err : new Error('Failed to load activity'))
        // If we don't have a cached fallback, mark hasMore false so the
        // sentinel doesn't keep retrying. With cache, leave it true so a
        // network recovery can resume.
        setHasMore(prev => (transactions.length > 0 ? prev : false))
      })
      .finally(() => {
        if (cancelled || id !== fetchIdRef.current) return
        setLoadingInitial(false)
        fetchingRef.current = false
      })
    return () => {
      cancelled = true
    }
    // `transactions` is read inside `setHasMore(prev => …)` so safe to
    // omit from deps; including it would refetch on every list update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nwcString, refreshKey])

  const loadMore = useCallback(async () => {
    if (!nwcString) return
    if (fetchingRef.current) return
    if (!hasMore) return
    if (transactions.length === 0) return

    fetchingRef.current = true
    setLoadingMore(true)
    const id = fetchIdRef.current
    try {
      const oldest = transactions[transactions.length - 1]
      // NWC `until` is in Unix seconds; our `createdAt` is ms. Subtract 1s
      // so the cursor is exclusive and we don't refetch the seam tx.
      const until = Math.floor(oldest.createdAt / 1000) - 1
      const next = await listTransactions(nwcString, {
        limit: PAGE_SIZE,
        until,
      })
      if (id !== fetchIdRef.current) return
      setTransactions(prev => {
        // Defensive de-dupe by paymentHash in case the wallet returns the
        // boundary tx anyway (some implementations treat `until` as
        // inclusive).
        const seen = new Set(prev.map(t => t.paymentHash))
        const fresh = next.filter(t => !seen.has(t.paymentHash))
        return [...prev, ...fresh]
      })
      setHasMore(next.length >= PAGE_SIZE)
      // Persist deeper history so a reload paints with everything the
      // user has paged through (capped per-wallet inside the cache).
      upsertMany(nwcCacheKey(nwcString), next)
    } catch (err) {
      if (id !== fetchIdRef.current) return
      setError(err instanceof Error ? err : new Error('Failed to load more'))
      setHasMore(false)
    } finally {
      if (id === fetchIdRef.current) {
        setLoadingMore(false)
      }
      fetchingRef.current = false
    }
  }, [nwcString, hasMore, transactions])

  const filtered = useMemo(
    () =>
      transactions.filter(tx =>
        tab === 'transfers' ? tx.type === 'outgoing' : true,
      ),
    [transactions, tab],
  )

  const groups = useMemo(() => groupByDay(filtered), [filtered])

  return (
    <div className="flex flex-1 flex-col pb-32">
      <ScreenHeader title="Activity" />

      <main className="flex flex-1 flex-col gap-4 px-4 pt-2">
        <div className="flex w-fit gap-1 rounded-full bg-card p-1">
          <Tab active={tab === 'all'} onClick={() => setTab('all')}>
            All
          </Tab>
          <button
            type="button"
            disabled
            aria-disabled
            className="cursor-not-allowed rounded-full px-3 py-1 text-xs font-medium text-muted-foreground/50"
          >
            Transfers
          </button>
        </div>

        <Body
          nwcString={nwcString}
          loadingInitial={loadingInitial}
          loadingMore={loadingMore}
          hasMore={hasMore}
          error={error}
          groups={groups}
          onLoadMore={loadMore}
        />
      </main>

      <NavTabbar />
    </div>
  )
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function Body({
  nwcString,
  loadingInitial,
  loadingMore,
  hasMore,
  error,
  groups,
  onLoadMore,
}: {
  nwcString: string | null
  loadingInitial: boolean
  loadingMore: boolean
  hasMore: boolean
  error: Error | null
  groups: { label: string; items: NwcTransaction[] }[]
  onLoadMore: () => void
}) {
  if (!nwcString) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Connect a wallet to see your transaction history.
        </p>
      </div>
    )
  }
  if (loadingInitial && groups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner size={16} />
        Loading activity…
      </div>
    )
  }
  if (error && groups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-destructive">{error.message}</p>
      </div>
    )
  }
  if (groups.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map(group => (
        <section key={group.label} className="flex flex-col gap-2">
          <h2 className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h2>
          <div className="flex flex-col rounded-xl bg-card/40">
            {group.items.map((tx, i) => (
              <div
                key={tx.paymentHash || `${tx.createdAt}-${i}`}
                className="border-b border-border/40 last:border-b-0"
              >
                <TransactionRow tx={tx} />
              </div>
            ))}
          </div>
        </section>
      ))}

      {hasMore && (
        <InfiniteSentinel
          onIntersect={onLoadMore}
          loading={loadingMore}
        />
      )}
      {!hasMore && groups.length > 0 && (
        <p className="py-4 text-center text-xs text-muted-foreground">
          You’ve reached the end.
        </p>
      )}
      {error && groups.length > 0 && (
        <p className="py-2 text-center text-xs text-destructive">
          {error.message}
        </p>
      )}
    </div>
  )
}

/**
 * Bottom-of-list sentinel that triggers `onIntersect` whenever it scrolls
 * into view. We pad it with a generous root margin so the next page is
 * already in flight by the time the user reaches the visible items —
 * keeps the scroll feeling continuous on a fast wrist-flick.
 */
function InfiniteSentinel({
  onIntersect,
  loading,
}: {
  onIntersect: () => void
  loading: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onIntersectRef = useRef(onIntersect)
  useEffect(() => {
    onIntersectRef.current = onIntersect
  }, [onIntersect])

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) onIntersectRef.current()
        }
      },
      { root: null, rootMargin: '480px 0px', threshold: 0 },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className="flex items-center justify-center py-6 text-sm text-muted-foreground"
    >
      {loading ? (
        <span className="inline-flex items-center gap-2">
          <Spinner size={16} />
          Loading more…
        </span>
      ) : (
        <span className="opacity-0">Load more</span>
      )}
    </div>
  )
}

/**
 * Merges a freshly-fetched page into an existing in-memory list,
 * deduping by `paymentHash` and re-sorting newest-first. Used both when
 * cache hydration races the live fetch and when a notification adds a
 * single new tx to the visible list.
 */
function mergeNewerFirst(
  current: NwcTransaction[],
  incoming: NwcTransaction[],
): NwcTransaction[] {
  if (incoming.length === 0) return current
  if (current.length === 0) {
    return [...incoming].sort((a, b) => b.createdAt - a.createdAt)
  }
  const seen = new Map<string, NwcTransaction>()
  for (const tx of current) seen.set(tx.paymentHash, tx)
  for (const tx of incoming) seen.set(tx.paymentHash, tx) // incoming wins on conflict
  return Array.from(seen.values()).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Buckets transactions into Today / Yesterday / longer-form date headers,
 * preserving the input order (which `listTransactions` returns most-recent-
 * first). Empty buckets are dropped.
 */
function groupByDay(transactions: NwcTransaction[]) {
  const out: { label: string; items: NwcTransaction[] }[] = []
  let currentLabel: string | null = null
  for (const tx of transactions) {
    const ts = tx.settledAt ?? tx.createdAt
    const label = labelForTimestamp(ts)
    if (label !== currentLabel) {
      out.push({ label, items: [] })
      currentLabel = label
    }
    out[out.length - 1].items.push(tx)
  }
  return out
}

function labelForTimestamp(ms: number): string {
  const d = new Date(ms)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (sameDay(d, today)) return 'Today'
  if (sameDay(d, yesterday)) return 'Yesterday'
  const diffMs = today.getTime() - d.getTime()
  if (diffMs < 7 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { weekday: 'long' })
  }
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  })
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}
