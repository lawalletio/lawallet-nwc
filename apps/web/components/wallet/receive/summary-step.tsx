'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useReceiveFlow, receiveActions } from '@/lib/client/wallet-flow-store'
import { formatDateTime } from '@/lib/client/format'
import { currencyUnitLabel, formatSatsAmount } from '@/lib/client/format-sats'
import { buildPaymentReceiptText } from '@/lib/client/payment-receipt'
import {
  PaymentProofCard,
  PaymentReceiptActions,
  PaymentReceiptCard,
  PaymentReceiptLayout,
  ReceiptDetailList,
  ReceiptProofRow,
  shareReceiptText,
  useReceiptCurrency
} from '@/components/wallet/shared/payment-receipt'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

const DEMO_PAYMENT_HASH =
  'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e'

const DEMO_RECEIVE_INVOICE = {
  bolt11: 'lnbc210n1test',
  paymentHash: DEMO_PAYMENT_HASH,
  amountSats: 21000,
  description: 'Coffee',
  expiresAt: null
}

const DEMO_SETTLED_AT = Date.parse('2026-09-19T12:53:00-03:00')

export function ReceiveSummaryStep() {
  const router = useRouter()
  const flow = useReceiveFlow()
  const { activeCurrencies, rates, activeCode, setCurrencyCode } =
    useReceiptCurrency()
  const trackedRef = useRef(false)
  const leavingRef = useRef(false)
  const previewSeededRef = useRef(false)

  useEffect(() => {
    // Skip the guard once the user has hit Done — resetting the flow nulls
    // `flow.invoice`, which would otherwise re-fire this effect and bounce them
    // back to /wallet/receive instead of the intended /wallet.
    if (leavingRef.current) return
    if (!flow.invoice) {
      if (seedDevPreviewIfRequested()) {
        previewSeededRef.current = true
        return
      }
      router.replace('/wallet/receive')
      return
    }
    if (!trackedRef.current && !previewSeededRef.current) {
      trackedRef.current = true
      trackEvent(AnalyticsEvent.WALLET_RECEIVE_COMPLETED)
    }
  }, [flow.invoice, router])

  if (!flow.invoice) return null

  const invoice = flow.invoice
  const amountLabel = `${formatSatsAmount(invoice.amountSats, activeCode, rates)} ${currencyUnitLabel(activeCode)}`
  const note = invoice.description.trim() || null
  const settledAt = flow.settledAt
  const settledProof = flow.settledPreimage?.trim() || null
  const preimage =
    settledProof && settledProof !== invoice.paymentHash ? settledProof : null
  const details = [
    { label: 'Note', value: note, include: Boolean(note) },
    {
      label: 'Time',
      value: settledAt ? formatDateTime(settledAt) : null,
      include: Boolean(settledAt)
    }
  ]
  const showDetails = details.some(item => item.include)

  function done() {
    leavingRef.current = true
    router.replace('/wallet')
    receiveActions.reset()
  }

  function share() {
    void shareReceiptText(
      buildPaymentReceiptText({
        amountLabel,
        comment: note,
        settledAt,
        paymentHash: invoice.paymentHash,
        preimage
      })
    )
  }

  return (
    <PaymentReceiptLayout
      footer={<PaymentReceiptActions onShare={share} onDone={done} />}
    >
      <PaymentReceiptCard
        title="Payment received"
        amountSats={invoice.amountSats}
        currencyCode={activeCode}
        currencies={activeCurrencies}
        rates={rates}
        onCurrencyChange={setCurrencyCode}
      >
        {showDetails ? <ReceiptDetailList items={details} /> : null}
      </PaymentReceiptCard>

      <PaymentProofCard>
        <ReceiptProofRow label="Payment hash" value={invoice.paymentHash} />
        {preimage ? (
          <ReceiptProofRow label="Preimage" value={preimage} secret />
        ) : null}
      </PaymentProofCard>
    </PaymentReceiptLayout>
  )
}

function seedDevPreviewIfRequested(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (typeof window === 'undefined') return false
  if (new URLSearchParams(window.location.search).get('preview') !== '1') {
    return false
  }
  receiveActions.setInvoice(DEMO_RECEIVE_INVOICE)
  receiveActions.markSettled('', DEMO_SETTLED_AT)
  return true
}
