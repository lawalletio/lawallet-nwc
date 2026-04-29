'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { nwcCacheKey } from '@/lib/client/cache/key'
import {
  readBalance,
  writeBalance,
} from '@/lib/client/cache/balance-cache'
import { upsertMany } from '@/lib/client/cache/activity-cache'

/**
 * Minimal shape of a NIP-47 transaction that we care about for UI.
 * Keep this aligned with `Nip47Transaction` from `@getalby/sdk`.
 */
export interface NwcTransactionEvent {
  type: 'incoming' | 'outgoing'
  amountSats: number
  feesPaidSats: number
  description: string
  paymentHash: string
  settledAt: number | null
}

/**
 * NWC relay connection status derived from request outcomes.
 * - `idle`     — no NWC configured
 * - `connecting` — a request is in flight and we don't yet have a confirmed
 *   successful response (initial load or after a failure)
 * - `connected` — the most recent request succeeded
 * - `disconnected` — the most recent request failed (relay unreachable,
 *   timeout, etc.)
 */
export type NwcStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

/**
 * Human label for an NwcStatus, matching the copy every card in the app
 * uses ("Connected" / "Disconnected" / "Connecting…"). Centralised here
 * so BalanceCard, NwcCard and any future surface stay in sync if we ever
 * rephrase these states. `idle` maps to "Connecting…" for parity with
 * the hook's very first tick before the initial `getBalance()` resolves.
 */
export function nwcStatusLabel(status: NwcStatus): string {
  switch (status) {
    case 'connected':
      return 'Connected'
    case 'disconnected':
      return 'Disconnected'
    case 'connecting':
    case 'idle':
      return 'Connecting…'
  }
}

interface BalanceState {
  /** Current balance in sats. Null while loading or on error. */
  sats: number | null
  loading: boolean
  error: Error | null
  /** Manually trigger a refetch. */
  refetch: () => void
  /** Unix timestamp (ms) when the balance was last refreshed. */
  updatedAt: number | null
  /** Live connection status. */
  status: NwcStatus
  /**
   * `true` while the displayed `sats` came from the local cache and a
   * fresh value hasn't landed yet. Consumers use this to render a
   * skeleton-pulse on the cached number rather than swapping it for a
   * spinner. Flips to `false` on the first successful `getBalance()`.
   */
  fromCache: boolean
}

const DEFAULT_POLL_MS = 30_000

/**
 * `@getalby/sdk` calls `console.error('Failed to request …', err)`
 * before rejecting every NIP-47 request that times out, which floods
 * the devtools console on every poll tick when the relay is down.
 * Our hook already catches the rejection and drives the UI status —
 * suppress the redundant SDK log exactly once per app load so we
 * don't silence unrelated errors and don't re-patch on every render.
 */
let sdkConsolePatchInstalled = false
function installSdkConsolePatch() {
  if (sdkConsolePatchInstalled) return
  sdkConsolePatchInstalled = true
  if (typeof window === 'undefined') return
  const orig = console.error
  console.error = (...args: unknown[]) => {
    const first = args[0]
    if (
      typeof first === 'string' &&
      first.startsWith('Failed to request')
    ) {
      return
    }
    orig.apply(console, args as [])
  }
}

/**
 * Connects to a NWC wallet via the Alby SDK and reads the balance.
 * Polls on an interval to keep the value fresh. Cleans up the underlying
 * relay connection when the NWC string changes or the component unmounts.
 *
 * When `onTransaction` is provided, subscribes to NIP-47 notifications
 * (`payment_received` / `payment_sent`) for real-time updates.
 */
export function useNwcBalance(
  nwcString: string | null,
  opts?: {
    pollMs?: number
    onTransaction?: (tx: NwcTransactionEvent) => void
  }
): BalanceState {
  const pollMs = opts?.pollMs ?? DEFAULT_POLL_MS
  // Seed lazily from the local cache so a reload paints the last-seen
  // balance immediately. `nwcCacheKey` is synchronous (FNV-1a) so this
  // happens in the same tick as state init — no flash of `null` and no
  // microtask gap before the cache hit lands.
  const initial = (() => {
    if (!nwcString) {
      return { sats: null as number | null, fromCache: false, updatedAt: null as number | null }
    }
    const cached = readBalance(nwcCacheKey(nwcString))
    if (!cached) {
      return { sats: null, fromCache: false, updatedAt: null }
    }
    return { sats: cached.sats, fromCache: true, updatedAt: cached.fetchedAt }
  })

  const [sats, setSats] = useState<number | null>(() => initial().sats)
  const [fromCache, setFromCache] = useState<boolean>(() => initial().fromCache)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(() => initial().updatedAt)
  const [status, setStatus] = useState<NwcStatus>('idle')

  // Internal nonce for a manual refetch trigger
  const [nonce, setNonce] = useState(0)
  const refetch = useCallback(() => setNonce(n => n + 1), [])

  // Track the active client so subsequent runs can close it cleanly
  const clientRef = useRef<{ close: () => void } | null>(null)

  // Keep the latest callback in a ref so we don't tear down the subscription
  // every time the parent re-renders with a new function identity.
  const onTransactionRef = useRef(opts?.onTransaction)
  useEffect(() => {
    onTransactionRef.current = opts?.onTransaction
  }, [opts?.onTransaction])

  // Track the last announced status so we only toast on transitions.
  // Initially `null` so the very first tick doesn't flash a disconnect
  // toast while we're still establishing the subscription.
  const lastAnnouncedRef = useRef<NwcStatus | null>(null)

  useEffect(() => {
    if (!nwcString) {
      setSats(null)
      setError(null)
      setLoading(false)
      setStatus('idle')
      setFromCache(false)
      lastAnnouncedRef.current = null
      return
    }

    // Resolve once per nwcString change; reused inside the closure for
    // both balance and activity-cache writes.
    const nwcKey = nwcCacheKey(nwcString)

    // The nwcString may have changed since the last render; re-seed from
    // cache so a wallet swap paints the new wallet's last-seen balance.
    const seeded = readBalance(nwcKey)
    if (seeded) {
      setSats(seeded.sats)
      setUpdatedAt(seeded.fetchedAt)
      setFromCache(true)
    } else {
      setFromCache(false)
    }

    installSdkConsolePatch()
    setStatus('connecting')

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null
    let unsubscribe: (() => void) | null = null

    async function load() {
      // Dynamic import keeps the SDK out of the initial bundle
      const { NWCClient } = await import('@getalby/sdk')

      // Tear down the previous client before creating a new one
      try {
        clientRef.current?.close()
      } catch {
        // ignore
      }

      const client = new NWCClient({ nostrWalletConnectUrl: nwcString! })
      clientRef.current = client

      async function fetchOnce() {
        if (cancelled) return
        setLoading(true)
        try {
          const res = await client.getBalance()
          if (cancelled) return
          // NWC returns balance in msats
          const fresh = Math.floor(res.balance / 1000)
          setSats(fresh)
          setError(null)
          setUpdatedAt(Date.now())
          setStatus('connected')
          setFromCache(false)
          // Persist for the next reload; failures (quota, disabled
          // storage) are swallowed by `writeBalance`.
          writeBalance(nwcKey, fresh)
          if (lastAnnouncedRef.current === 'disconnected') {
            toast.success('Wallet reconnected')
          }
          lastAnnouncedRef.current = 'connected'
        } catch (err) {
          if (cancelled) return
          const e = err instanceof Error ? err : new Error(String(err))
          setError(e)
          setStatus('disconnected')
          // Only announce the transition once per disconnection. Subsequent
          // poll ticks while still down stay silent so we don't spam a
          // toast every 30 s on a flaky relay.
          if (lastAnnouncedRef.current !== 'disconnected') {
            const isTimeout = /reply timeout/i.test(e.message)
            toast.error(
              isTimeout
                ? 'Wallet relay timed out. Retrying in the background…'
                : 'Wallet disconnected. Retrying in the background…',
            )
            lastAnnouncedRef.current = 'disconnected'
          }
        } finally {
          if (!cancelled) setLoading(false)
        }
      }

      await fetchOnce()
      intervalId = setInterval(fetchOnce, pollMs)

      // Subscribe to NIP-47 notifications for real-time updates
      try {
        unsubscribe = await client.subscribeNotifications(notification => {
          if (cancelled) return
          const tx = notification.notification
          // Refresh balance on any payment event so the UI stays in sync
          fetchOnce()
          const event = {
            type: tx.type,
            amountSats: Math.floor(tx.amount / 1000),
            feesPaidSats: Math.floor((tx.fees_paid ?? 0) / 1000),
            description: tx.description ?? '',
            paymentHash: tx.payment_hash,
            settledAt: tx.settled_at ? tx.settled_at * 1000 : null,
          }
          onTransactionRef.current?.(event)
          // Mirror the new tx into the activity cache so the next reload
          // (or a freshly-mounted ActivityScreen) paints with it
          // pre-applied. `upsertMany` swallows IDB errors itself.
          upsertMany(nwcKey, [
            {
              type: event.type,
              amountSats: event.amountSats,
              feesPaidSats: event.feesPaidSats,
              description: event.description,
              paymentHash: event.paymentHash,
              preimage: null,
              settledAt: event.settledAt,
              createdAt: event.settledAt ?? Date.now(),
            },
          ])
        }, ['payment_received', 'payment_sent'])
      } catch {
        // Wallet may not support notifications — polling still works.
      }
    }

    load().catch(err => {
      if (!cancelled) {
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
      try {
        unsubscribe?.()
      } catch {
        // ignore
      }
      try {
        clientRef.current?.close()
      } catch {
        // ignore
      }
      clientRef.current = null
    }
  }, [nwcString, pollMs, nonce])

  return { sats, loading, error, refetch, updatedAt, status, fromCache }
}
