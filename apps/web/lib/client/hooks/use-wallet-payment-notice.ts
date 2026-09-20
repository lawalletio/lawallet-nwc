'use client'

import { useCallback, useEffect, useState } from 'react'
import { claimNotification } from '@/lib/client/cache/nwc-notification-dedupe'
import type { NwcTransactionEvent } from '@/lib/client/use-nwc-balance'

export const WALLET_PAYMENT_NOTICE_MS = 3_800

export interface WalletPaymentCue {
  id: string
  nwcKey: string
  type: 'incoming' | 'outgoing'
  amountSats: number
  description: string
}

/**
 * Home-only payment cue. `onTransaction` is meant to run from
 * `useWalletNwcTransactions` while `/wallet` is mounted: the first time a
 * `{type, paymentHash}` lands we expose it as `cue`; replays are ignored.
 *
 * Returns `true` when this event claimed the cue so callers can skip
 * duplicate activity ticks / optimistic rows.
 *
 * Callers that are *not* on home should `markNotificationSeen` instead so
 * returning to home does not animate a payment the user already finished
 * on send/receive.
 */
export function useWalletPaymentNotice(nwcKey: string | null): {
  cue: WalletPaymentCue | null
  onTransaction: (tx: NwcTransactionEvent) => boolean
} {
  const [cue, setCue] = useState<WalletPaymentCue | null>(null)

  const onTransaction = useCallback(
    (tx: NwcTransactionEvent) => {
      if (!nwcKey) return false
      if (!claimNotification(nwcKey, tx)) return false
      setCue({
        id: `${tx.type}:${tx.paymentHash}`,
        nwcKey,
        type: tx.type,
        amountSats: tx.amountSats,
        description: tx.description
      })
      return true
    },
    [nwcKey]
  )

  useEffect(() => {
    if (!cue) return
    const timer = window.setTimeout(
      () => setCue(null),
      WALLET_PAYMENT_NOTICE_MS
    )
    return () => window.clearTimeout(timer)
  }, [cue])

  const visibleCue = cue && nwcKey && cue.nwcKey === nwcKey ? cue : null

  return { cue: visibleCue, onTransaction }
}
