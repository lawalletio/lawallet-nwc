'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  useWalletNwc,
  useWalletNwcTransactions
} from '@/components/wallet/nwc-provider'
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
import { lookupInvoice } from '@/lib/client/nwc/receive'
import { useT } from '@/lib/client/i18n'

/** How long an accepted tap keeps checking our own wallet for the payment. */
const TAP_SETTLE_POLL_MS = 300
const TAP_SETTLE_TIMEOUT_MS = 30_000

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
  const t = useT()
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

  const { nwcString } = useWalletNwc()
  const paymentHash = flow.invoice?.paymentHash ?? null

  // Advance to the summary once the minted invoice is settled. A BoltCard tap
  // holds that navigation briefly so the success animation can play.
  function settle(settledAt: number) {
    if (!paymentHash) return
    receiveActions.markSettled(paymentHash, settledAt)
    if (navTimerRef.current != null) return
    const elapsed = celebratingRef.current
      ? Date.now() - acceptedAtRef.current
      : BOLTCARD_SUCCESS_HOLD_MS
    const wait = Math.max(0, BOLTCARD_SUCCESS_HOLD_MS - elapsed)
    navTimerRef.current = setTimeout(() => {
      router.replace('/wallet/receive/summary')
    }, wait)
  }
  const settleRef = useRef(settle)
  useEffect(() => {
    settleRef.current = settle
  })

  useWalletNwcTransactions(tx => {
    if (
      tx.type === 'incoming' &&
      tx.paymentHash === paymentHash &&
      tx.settledAt !== null
    ) {
      settle(tx.settledAt)
    }
  })

  // Once the card's server accepts the tap, ask our own wallet directly
  // instead of waiting on a NIP-47 notification — some wallets never send
  // one, which left this screen stuck on "Card accepted".
  const tapAccepted = nfc.phase === 'accepted'
  useEffect(() => {
    if (!tapAccepted || !nwcString || !paymentHash) return
    let cancelled = false
    void (async () => {
      const deadline = Date.now() + TAP_SETTLE_TIMEOUT_MS
      while (!cancelled && Date.now() < deadline) {
        try {
          const status = await lookupInvoice(nwcString, paymentHash)
          if (status.settled) {
            if (!cancelled) settleRef.current(Date.now())
            return
          }
        } catch {
          // Transient relay error — keep checking until the deadline.
        }
        await new Promise(resolve => setTimeout(resolve, TAP_SETTLE_POLL_MS))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tapAccepted, nwcString, paymentHash])

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
            {t.receive.waitingPayment}
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
