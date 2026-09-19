'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  sendActions,
  useSendFlow,
  type SendFlowResult
} from '@/lib/client/wallet-flow-store'
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

/**
 * Local-only receipt so `/wallet/send/summary?preview=1` can be opened without
 * completing a live payment. Never seeded in production builds.
 */
const DEMO_SEND_RESULT: SendFlowResult = {
  preimage: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  feesPaidSats: 3,
  amountSats: 21000,
  recipient: 'Satoshi',
  paymentHash:
    'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
  destination: 'satoshi@example.com',
  comment: 'Coffee',
  settledAt: Date.parse('2026-09-19T12:53:00-03:00')
}

export function SendSummaryStep() {
  const router = useRouter()
  const flow = useSendFlow()
  const { activeCurrencies, rates, activeCode, setCurrencyCode } =
    useReceiptCurrency()
  const trackedRef = useRef(false)
  const leavingRef = useRef(false)
  const previewSeededRef = useRef(false)

  useEffect(() => {
    // Skip the guard once the user has hit Done — resetting the flow nulls
    // `flow.result`, which would otherwise re-fire this effect and bounce them
    // back to /wallet/send instead of the intended /wallet.
    if (leavingRef.current) return
    if (!flow.result) {
      if (seedDevPreviewIfRequested()) {
        previewSeededRef.current = true
        return
      }
      router.replace('/wallet/send')
      return
    }
    if (!trackedRef.current && !previewSeededRef.current) {
      trackedRef.current = true
      trackEvent(AnalyticsEvent.WALLET_SEND_COMPLETED)
    }
  }, [flow.result, router])

  if (!flow.result) return null

  const result = flow.result
  const amountLabel = `${formatSatsAmount(result.amountSats, activeCode, rates)} ${currencyUnitLabel(activeCode)}`
  const feeLabel = `${formatSatsAmount(result.feesPaidSats, activeCode, rates)} ${currencyUnitLabel(activeCode)}`

  function done() {
    leavingRef.current = true
    router.replace('/wallet')
    sendActions.reset()
  }

  function share() {
    void shareReceiptText(
      buildPaymentReceiptText({
        amountLabel,
        feeLabel,
        recipient: result.recipient,
        destination: result.destination,
        comment: result.comment,
        settledAt: result.settledAt,
        paymentHash: result.paymentHash,
        preimage: result.preimage
      })
    )
  }

  return (
    <PaymentReceiptLayout
      footer={<PaymentReceiptActions onShare={share} onDone={done} />}
    >
      <PaymentReceiptCard
        title="Payment sent"
        amountSats={result.amountSats}
        currencyCode={activeCode}
        currencies={activeCurrencies}
        rates={rates}
        onCurrencyChange={setCurrencyCode}
      >
        <ReceiptDetailList
          items={[
            { label: 'To', value: result.recipient || null },
            {
              label: 'Network fee',
              value: feeLabel,
              valueClassName: 'tabular-nums'
            },
            {
              label: 'Destination',
              value: result.destination,
              include: Boolean(
                result.destination && result.destination !== result.recipient
              )
            },
            {
              label: 'Note',
              value: result.comment,
              include: Boolean(result.comment)
            },
            {
              label: 'Time',
              value: result.settledAt
                ? formatDateTime(result.settledAt)
                : null
            }
          ]}
        />
      </PaymentReceiptCard>

      <PaymentProofCard>
        <ReceiptProofRow label="Payment hash" value={result.paymentHash} />
        <ReceiptProofRow label="Preimage" value={result.preimage} secret />
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
  sendActions.setResult(DEMO_SEND_RESULT)
  return true
}
