'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode
} from 'react'
import { useApi } from '@/lib/client/hooks/use-api'
import { resolveUserNwc } from '@/lib/client/wallet-nwc'
import { nwcCacheKey } from '@/lib/client/cache/key'
import { markNotificationSeen } from '@/lib/client/cache/nwc-notification-dedupe'
import {
  useWalletPaymentNotice,
  type WalletPaymentCue
} from '@/lib/client/hooks/use-wallet-payment-notice'
import { WalletPaymentNoticeOverlay } from '@/components/wallet/payment-notice-overlay'
import {
  useNwcBalance,
  type NwcBalanceState,
  type NwcTransactionEvent
} from '@/lib/client/use-nwc-balance'

interface UserMeResponse {
  effectiveNwcString: string | null
  nwcString: string
}

interface WalletNwcValue extends NwcBalanceState {
  /** The wallet's connection string, or null when none is configured. */
  nwcString: string | null
  /** Live payment cue claimed by this provider, if any. */
  cue: WalletPaymentCue | null
  /** Register a NIP-47 payment listener. Returns an unsubscribe. */
  subscribe: (listener: (tx: NwcTransactionEvent) => void) => () => void
}

const WalletNwcContext = createContext<WalletNwcValue | null>(null)

/**
 * Owns the single NWC relay connection for the wallet app. Mounted in the
 * `/wallet` layout, which survives navigation between subpages — so the
 * balance, the poll interval and the NIP-47 subscription stay live instead
 * of reconnecting on every screen. Screens read the shared state through
 * `useWalletNwc` / `useWalletNwcTransactions`. The payment-notice overlay
 * lives here too so `/wallet` and `/wallet/receive` share the same cue.
 */
export function WalletNwcProvider({ children }: { children: ReactNode }) {
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const nwcString = resolveUserNwc(me)
  const nwcKey = nwcString ? nwcCacheKey(nwcString) : null
  const { cue, onTransaction: claimCue } = useWalletPaymentNotice(nwcKey)

  const listenersRef = useRef(new Set<(tx: NwcTransactionEvent) => void>())
  // Claim the overlay first so home/receive share one cue, fan-out so
  // invoice settlement and activity still hear the event, then mark seen
  // so a later visit does not replay motion.
  const onTransaction = useCallback(
    (tx: NwcTransactionEvent) => {
      claimCue(tx)
      for (const listener of listenersRef.current) listener(tx)
      if (nwcKey) markNotificationSeen(nwcKey, tx)
    },
    [nwcKey, claimCue]
  )
  const subscribe = useCallback(
    (listener: (tx: NwcTransactionEvent) => void) => {
      listenersRef.current.add(listener)
      return () => {
        listenersRef.current.delete(listener)
      }
    },
    []
  )

  const balance = useNwcBalance(nwcString, { onTransaction })

  // Local-dev only: `?devPayment=incoming|outgoing` fires a one-shot NIP-47
  // shaped event through the real listener path so the wallet cue can be
  // exercised without a live Lightning wallet. Stripped from production.
  const lastDevPaymentRef = useRef<string | null>(null)
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return
    if (!nwcString) return
    const kind = new URLSearchParams(window.location.search).get('devPayment')
    if (kind !== 'incoming' && kind !== 'outgoing') return
    if (lastDevPaymentRef.current === kind) return
    lastDevPaymentRef.current = kind
    const tx: NwcTransactionEvent = {
      type: kind,
      amountSats: kind === 'incoming' ? 2100 : 800,
      feesPaidSats: 0,
      description: 'Local test',
      paymentHash: `dev-${kind}-${Date.now()}`,
      settledAt: Date.now()
    }
    const timer = window.setTimeout(() => onTransaction(tx), 700)
    return () => window.clearTimeout(timer)
  }, [nwcString, onTransaction])

  return (
    <WalletNwcContext.Provider
      value={{ ...balance, nwcString, cue, subscribe }}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <WalletPaymentNoticeOverlay cue={cue} />
        {children}
      </div>
    </WalletNwcContext.Provider>
  )
}

/** Shared balance + connection status. Throws outside the wallet layout. */
export function useWalletNwc(): WalletNwcValue {
  const ctx = useContext(WalletNwcContext)
  if (!ctx) {
    throw new Error('useWalletNwc must be used inside <WalletNwcProvider>')
  }
  return ctx
}

/**
 * Runs `listener` on every NIP-47 payment event seen by the shared
 * connection. The latest callback is used without re-subscribing.
 */
export function useWalletNwcTransactions(
  listener: (tx: NwcTransactionEvent) => void
): void {
  const { subscribe } = useWalletNwc()
  const listenerRef = useRef(listener)
  useEffect(() => {
    listenerRef.current = listener
  })
  useEffect(() => subscribe(tx => listenerRef.current(tx)), [subscribe])
}
