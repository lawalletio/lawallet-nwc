'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useApi } from '@/lib/client/hooks/use-api'
import { resolveUserNwc } from '@/lib/client/wallet-nwc'
import {
  lookupTransaction,
  nwcTransactionState,
  type NwcTransaction
} from '@/lib/client/nwc'
import { nwcCacheKey } from '@/lib/client/cache/key'
import {
  readByPaymentHash,
  upsertMany
} from '@/lib/client/cache/activity-cache'
import {
  rememberActivityTx,
  recallActivityTx
} from '@/lib/client/activity-detail-store'
import {
  activityDetailBackHref,
  seedPreviewActivityTx
} from '@/lib/client/activity-detail'
import { formatDateTime } from '@/lib/client/format'
import { currencyUnitLabel, formatSatsAmount } from '@/lib/client/format-sats'
import { buildPaymentReceiptText } from '@/lib/client/payment-receipt'
import { ScreenHeader } from '@/components/wallet/shared/screen-header'
import {
  PaymentProofCard,
  PaymentReceiptActions,
  PaymentReceiptCard,
  PaymentReceiptLayout,
  ReceiptDetailList,
  ReceiptProofRow,
  shareReceiptText,
  useReceiptCurrency,
  type ReceiptDetailItem
} from '@/components/wallet/shared/payment-receipt'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useT } from '@/lib/client/i18n'

interface UserMeResponse {
  effectiveNwcString: string | null
  nwcString: string
}

export function ActivityDetailScreen({
  paymentHash,
  from
}: {
  paymentHash: string
  from?: string
}) {
  const t = useT()
  const router = useRouter()
  const backHref = activityDetailBackHref(from)
  const hash = decodeURIComponent(paymentHash).trim()
  const { data: me, loading: meLoading } =
    useApi<UserMeResponse>('/api/users/me')
  const nwcString = resolveUserNwc(me)
  const { activeCurrencies, rates, activeCode, setCurrencyCode } =
    useReceiptCurrency()

  const [tx, setTx] = useState<NwcTransaction | null>(() =>
    recallActivityTx(hash)
  )
  const [loading, setLoading] = useState(() => !recallActivityTx(hash))
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let cancelled = false
    const remembered = recallActivityTx(hash)

    async function load() {
      if (!hash) {
        if (!cancelled) {
          setTx(null)
          setNotFound(true)
          setLoading(false)
        }
        return
      }

      if (remembered) {
        setTx(remembered)
        setNotFound(false)
        setLoading(false)
      } else {
        setLoading(true)
      }

      let found = Boolean(remembered)

      const preview = seedPreviewActivityTx(hash)
      if (preview) {
        rememberActivityTx(preview)
        if (!cancelled) {
          setTx(preview)
          setNotFound(false)
          setLoading(false)
        }
        return
      }

      if (nwcString) {
        const cached = await readByPaymentHash(nwcCacheKey(nwcString), hash)
        if (cancelled) return
        if (cached) {
          rememberActivityTx(cached)
          setTx(cached)
          setNotFound(false)
          setLoading(false)
          found = true
        }

        const live = await lookupTransaction(nwcString, hash)
        if (cancelled) return
        if (live) {
          rememberActivityTx(live)
          setTx(live)
          setNotFound(false)
          setLoading(false)
          void upsertMany(nwcCacheKey(nwcString), [live])
          return
        }
      } else if (meLoading) {
        if (!found && !cancelled) setLoading(true)
        return
      }

      if (!cancelled && !found) {
        setTx(null)
        setNotFound(true)
        setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [hash, nwcString, meLoading])

  function goBack() {
    router.replace(backHref)
  }

  if (loading && !tx) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScreenHeader onBack={goBack} />
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner size={16} />
          {t.activity.detail.loading}
        </div>
      </div>
    )
  }

  if (notFound || !tx) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ScreenHeader onBack={goBack} />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t.activity.detail.notFound}
          </p>
          <Button type="button" variant="secondary" onClick={goBack}>
            {t.activity.detail.backToActivity}
          </Button>
        </div>
      </div>
    )
  }

  const status = nwcTransactionState(tx)
  const incoming = tx.type === 'incoming'
  const d = t.activity.detail
  const title =
    status === 'pending'
      ? d.pending
      : status === 'failed'
        ? d.failed
        : incoming
          ? d.received
          : d.sent
  const amountLabel = `${formatSatsAmount(tx.amountSats, activeCode, rates)} ${currencyUnitLabel(activeCode)}`
  const feeLabel = `${formatSatsAmount(tx.feesPaidSats, activeCode, rates)} ${currencyUnitLabel(activeCode)}`
  const counterpart = tx.description.trim() || null
  const timestamp = tx.settledAt ?? tx.createdAt
  const preimage = tx.preimage?.trim() || null
  const showPreimage = Boolean(
    preimage && (incoming ? preimage !== tx.paymentHash : true)
  )

  const details: ReceiptDetailItem[] = incoming
    ? [
        { label: d.note, value: counterpart, include: Boolean(counterpart) },
        {
          label: d.time,
          value: timestamp ? formatDateTime(timestamp) : null,
          include: Boolean(timestamp)
        }
      ]
    : [
        { label: d.to, value: counterpart },
        {
          label: d.networkFee,
          value: feeLabel,
          valueClassName: 'tabular-nums'
        },
        {
          label: d.time,
          value: timestamp ? formatDateTime(timestamp) : null
        }
      ]

  const showDetails = details.some(item => item.include !== false)
  const receipt = tx

  function share() {
    void shareReceiptText(
      buildPaymentReceiptText(
        {
          amountLabel,
          feeLabel: incoming ? null : feeLabel,
          recipient: incoming ? undefined : (counterpart ?? undefined),
          comment: incoming ? counterpart : null,
          settledAt: timestamp,
          paymentHash: receipt.paymentHash,
          preimage: showPreimage ? preimage : null,
          status
        },
        t
      ),
      t
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ScreenHeader onBack={goBack} />
      <PaymentReceiptLayout
        footer={<PaymentReceiptActions onShare={share} onDone={goBack} />}
      >
        <PaymentReceiptCard
          title={title}
          amountSats={tx.amountSats}
          currencyCode={activeCode}
          currencies={activeCurrencies}
          rates={rates}
          onCurrencyChange={setCurrencyCode}
          status={status}
        >
          {showDetails ? <ReceiptDetailList items={details} /> : null}
        </PaymentReceiptCard>

        <PaymentProofCard>
          <ReceiptProofRow label={d.paymentHash} value={tx.paymentHash} />
          {incoming ? (
            showPreimage ? (
              <ReceiptProofRow label={d.preimage} value={preimage} secret />
            ) : null
          ) : (
            <ReceiptProofRow label={d.preimage} value={preimage} secret />
          )}
        </PaymentProofCard>
      </PaymentReceiptLayout>
    </div>
  )
}
