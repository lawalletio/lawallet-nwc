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
  /** Register a NIP-47 payment listener. Returns an unsubscribe. */
  subscribe: (listener: (tx: NwcTransactionEvent) => void) => () => void
}

const WalletNwcContext = createContext<WalletNwcValue | null>(null)

/**
 * Owns the single NWC relay connection for the wallet app. Mounted in the
 * `/wallet` layout, which survives navigation between subpages — so the
 * balance, the poll interval and the NIP-47 subscription stay live instead
 * of reconnecting on every screen. Screens read the shared state through
 * `useWalletNwc` / `useWalletNwcTransactions`.
 */
export function WalletNwcProvider({ children }: { children: ReactNode }) {
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const nwcString = resolveUserNwc(me)

  const listenersRef = useRef(new Set<(tx: NwcTransactionEvent) => void>())
  const onTransaction = useCallback((tx: NwcTransactionEvent) => {
    for (const listener of listenersRef.current) listener(tx)
  }, [])
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

  return (
    <WalletNwcContext.Provider value={{ ...balance, nwcString, subscribe }}>
      {children}
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
