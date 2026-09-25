'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useWalletNwcTransactions } from '@/components/wallet/nwc-provider'
import { QrDisplay } from '@/components/wallet/shared/qr-display'
import {
  BoltcardAccepted,
  BoltcardNfcStatus
} from '@/components/wallet/receive/boltcard-nfc-status'
import {
  BOLTCARD_SUCCESS_HOLD_MS,
  useBoltcardNfc
} from '@/lib/client/hooks/use-boltcard-nfc'
import { useReceiveFlow, receiveActions } from '@/lib/client/wallet-flow-store'

const PREVIEW_INVOICE = {
  bolt11: 'lnbc210n1test',
  paymentHash:
    'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
  amountSats: 21000,
  description: 'Coffee',
  expiresAt: null
}

export function ReceiveInvoiceStep() {
  const router = useRouter()
  const flow = useReceiveFlow()
  const celebratingRef = useRef(false)
  const acceptedAtRef = useRef(0)
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const nfc = useBoltcardNfc({
    active: Boolean(flow.invoice),
    bolt11: flow.invoice?.bolt11 ?? null,
    amountSats: flow.invoice?.amountSats ?? null,
    onAccepted: () => {
      celebratingRef.current = true
      acceptedAtRef.current = Date.now()
    }
  })

  // Watch the shared NIP-47 subscription; when a payment_received matches
  // the minted invoice, advance to the summary screen. A BoltCard tap holds
  // that navigation briefly so the success animation can play.
  useWalletNwcTransactions(tx => {
    if (
      tx.type === 'incoming' &&
      flow.invoice &&
      tx.paymentHash === flow.invoice.paymentHash &&
      tx.settledAt !== null
    ) {
      receiveActions.markSettled(tx.paymentHash, tx.settledAt)
      if (navTimerRef.current != null) return
      const elapsed = celebratingRef.current
        ? Date.now() - acceptedAtRef.current
        : BOLTCARD_SUCCESS_HOLD_MS
      const wait = Math.max(0, BOLTCARD_SUCCESS_HOLD_MS - elapsed)
      navTimerRef.current = setTimeout(() => {
        router.replace('/wallet/receive/summary')
      }, wait)
    }
  })

  useEffect(() => {
    if (!flow.invoice) {
      if (seedDevPreviewIfRequested()) return
      router.replace('/wallet/receive')
    }
  }, [flow.invoice, router])

  useEffect(() => {
    return () => {
      if (navTimerRef.current != null) clearTimeout(navTimerRef.current)
    }
  }, [])

  if (!flow.invoice) return null

  const invoice = flow.invoice
  const accepted = nfc.phase === 'accepted'
  const preview = `${invoice.bolt11.slice(0, 12)}…${invoice.bolt11.slice(-8)}`

  return (
    <div className="flex flex-1 flex-col px-4 pb-6">
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="flex items-baseline gap-2 tabular-nums">
          <span className="text-4xl font-semibold text-foreground">
            {invoice.amountSats.toLocaleString()}
          </span>
          <span className="text-base text-muted-foreground">sats</span>
        </div>

        {invoice.description && (
          <p className="text-sm text-muted-foreground">{invoice.description}</p>
        )}

        {accepted ? (
          <BoltcardAccepted amountSats={invoice.amountSats} />
        ) : (
          <QrDisplay
            value={invoice.bolt11}
            caption={preview}
            uppercasePayload
          />
        )}

        {accepted || nfc.phase === 'charging' ? null : (
          <p className="text-center text-xs text-muted-foreground">
            Waiting for payment…
          </p>
        )}

        {accepted ? null : (
          <BoltcardNfcStatus
            phase={nfc.phase}
            detail={nfc.detail}
            onEnable={nfc.enable}
            onRetry={nfc.retry}
          />
        )}
      </div>
    </div>
  )
}

function seedDevPreviewIfRequested(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).get('preview') !== '1') {
    return false
  }
  receiveActions.setInvoice(PREVIEW_INVOICE)
  return true
}
