'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useApi } from '@/lib/client/hooks/use-api'
import { useNwcBalance } from '@/lib/client/use-nwc-balance'
import { QrDisplay } from '@/components/wallet/shared/qr-display'
import {
  useReceiveFlow,
  receiveActions,
} from '@/lib/client/wallet-flow-store'

interface UserMeResponse {
  effectiveNwcString: string | null
}

export function ReceiveInvoiceStep() {
  const router = useRouter()
  const flow = useReceiveFlow()
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const effectiveNwc = me?.effectiveNwcString ?? null

  // Subscribe to NIP-47 notifications; when we see a payment_received whose
  // payment hash matches the minted invoice, advance to the summary screen.
  useNwcBalance(effectiveNwc, {
    onTransaction: tx => {
      if (
        tx.type === 'incoming' &&
        flow.invoice &&
        tx.paymentHash === flow.invoice.paymentHash &&
        tx.settledAt !== null
      ) {
        receiveActions.markSettled(tx.paymentHash)
        router.replace('/wallet/receive/summary')
      }
    },
  })

  useEffect(() => {
    if (!flow.invoice) {
      router.replace('/wallet/receive')
    }
  }, [flow.invoice, router])

  if (!flow.invoice) return null

  const preview = `${flow.invoice.bolt11.slice(0, 12)}…${flow.invoice.bolt11.slice(-8)}`

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-4xl font-semibold text-foreground">
            {flow.invoice.amountSats.toLocaleString()}
          </span>
          <span className="text-base text-muted-foreground">sats</span>
        </div>

        {flow.invoice.description && (
          <p className="text-sm text-muted-foreground">
            {flow.invoice.description}
          </p>
        )}

        <QrDisplay
          value={flow.invoice.bolt11}
          caption={preview}
          uppercasePayload
        />

        <p className="text-center text-xs text-muted-foreground">
          Waiting for payment…
        </p>
      </div>
    </div>
  )
}
