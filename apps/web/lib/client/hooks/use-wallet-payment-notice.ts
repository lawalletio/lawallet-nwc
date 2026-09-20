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
 * Layout-level payment cue, owned by `WalletNwcProvider`. The first time a
 * `{type, paymentHash}` lands we expose it as `cue`; replays are ignored.
 *
 * Returns `true` when this event claimed the cue.
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
