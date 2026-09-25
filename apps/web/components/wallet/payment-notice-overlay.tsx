'use client'

import { useEffect } from 'react'
import { PaymentNotice } from '@/components/wallet/home/payment-notice'
import type { WalletPaymentCue } from '@/lib/client/hooks/use-wallet-payment-notice'
import { playPaymentCueSound } from '@/lib/client/payment-sound'

/**
 * Layout-level payment cue. Positioned absolutely over the wallet chrome so
 * it does not take flow space on home, receive, or any other `/wallet`
 * screen the NWC provider wraps.
 */
export function WalletPaymentNoticeOverlay({
  cue
}: {
  cue: WalletPaymentCue | null
}) {
  useEffect(() => {
    if (!cue) return
    playPaymentCueSound(cue.id)
  }, [cue])

  if (!cue) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-30 flex justify-center px-4">
      <PaymentNotice
        key={cue.id}
        cue={cue}
        amountLabel={cue.amountSats.toLocaleString()}
        unit="sats"
      />
    </div>
  )
}
