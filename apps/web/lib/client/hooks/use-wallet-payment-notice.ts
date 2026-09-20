'use client'

import { useCallback, useEffect, useState } from 'react'
import { claimNotification } from '@/lib/client/cache/nwc-notification-dedupe'
import type { NwcTransactionEvent } from '@/lib/client/use-nwc-balance'

export const WALLET_PAYMENT_NOTICE_MS = 3_800

export interface WalletPaymentCue {
  id: string
  type: 'incoming' | 'outgoing'
  amountSats: number
  description: string
}

/**
 * Home-only payment cue. `onTransaction` is meant to run from
 * `useWalletNwcTransactions` while `/wallet` is mounted: the first time a
 * `{type, paymentHash}` lands we expose it as `cue`; replays are ignored.
 *
 * Callers that are *not* on home should `markNotificationSeen` instead so
 * returning to home does not animate a payment the user already finished
 * on send/receive.
 */
export function useWalletPaymentNotice(nwcKey: string | null): {
  cue: WalletPaymentCue | null
  onTransaction: (tx: NwcTransactionEvent) => void
} {
  const [cue, setCue] = useState<WalletPaymentCue | null>(null)

  const onTransaction = useCallback(
    (tx: NwcTransactionEvent) => {
      if (!nwcKey) return
      if (!claimNotification(nwcKey, tx)) return
      setCue({
        id: `${tx.type}:${tx.paymentHash}`,
        type: tx.type,
        amountSats: tx.amountSats,
        description: tx.description
      })
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

  return { cue, onTransaction }
}
