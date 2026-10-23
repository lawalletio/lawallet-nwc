'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { useAuth } from '@/components/admin/auth-context'
import { TransactionLabel } from './transaction-label'
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
  isActivityPreviewRequested,
  seedPreviewActivityTx
} from '@/lib/client/activity-detail'
import { formatDateTime } from '@/lib/client/format'
import { currencyUnitLabel, formatSatsAmount } from '@/lib/client/format-sats'
import { buildPaymentReceiptText } from '@/lib/client/payment-receipt'
import {
  splitPaymentDescription,
  useAddressAvatar,
  usePaymentDestination
} from '@/lib/client/payment-destinations'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { parseDestination } from '@/lib/client/nwc/parse-destination'
import { sendActions } from '@/lib/client/wallet-flow-store'
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

const LN_ADDRESS_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ActivityDetailScreen({
  paymentHash,
  from
}: {
  paymentHash: string
  from?: string
}) {
  const t = useT()
  const router = useRouter()
  const { pubkey } = useAuth()
  const backHref = activityDetailBackHref(from)
  const hash = decodeURIComponent(paymentHash).trim()
  const destination = usePaymentDestination(hash)
  const [tx, setTx] = useState<NwcTransaction | null>(() =>
    recallActivityTx(hash)
  )
  // Sends from before destinations were saved only carry the address in
  // the invoice description.
  const describedAddress = tx?.description.trim() ?? ''
  const recipientAddress =
    destination?.address ??
    (tx?.type === 'outgoing' && LN_ADDRESS_RE.test(describedAddress)
      ? describedAddress
      : null)
  const recipientAvatar = useAddressAvatar(
    recipientAddress,
    destination?.avatarUrl
  )
  const { data: me, loading: meLoading } =
    useApi<UserMeResponse>('/api/users/me')
  const nwcString = resolveUserNwc(me)
  const { activeCurrencies, rates, activeCode, setCurrencyCode } =
    useReceiptCurrency()

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
  const described = splitPaymentDescription(tx.description)
  const counterpart = incoming
    ? described.comment || described.label || null
    : destination?.address || described.label || null
  const outgoingNote = destination ? destination.comment : described.comment
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
        {
          label: d.to,
          value: counterpart,
          valueNode: recipientAddress ? (
            <button
              type="button"
              onClick={() => payAgain(recipientAddress)}
              aria-label={d.sendAgain(recipientAddress)}
              className="-my-1 inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background/60 py-1 pl-1 pr-2.5 text-left transition-colors hover:border-[var(--theme-300)] hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Avatar className="size-6">
                {recipientAvatar && (
                  <AvatarImage
                    src={recipientAvatar}
                    alt=""
                    className="object-cover"
                  />
                )}
                <AvatarFallback className="text-[10px] uppercase">
                  {recipientAddress.slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 truncate">{recipientAddress}</span>
              <Send className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          ) : undefined
        },
        { label: d.note, value: outgoingNote, include: Boolean(outgoingNote) },
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

  // Tapping the recipient starts a fresh send to the same address.
  function payAgain(address: string) {
    try {
      const next = parseDestination(address)
      sendActions.reset()
      sendActions.setRecipient({ raw: address, destination: next })
      router.push('/wallet/send/amount')
    } catch {
      router.push('/wallet/send')
    }
  }

  function share() {
    void shareReceiptText(
      buildPaymentReceiptText(
        {
          amountLabel,
          feeLabel: incoming ? null : feeLabel,
          recipient: incoming ? undefined : (counterpart ?? undefined),
          comment: incoming ? counterpart : outgoingNote,
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
        {!isActivityPreviewRequested() && /^[0-9a-fA-F]{64}$/.test(hash) ? (
          <TransactionLabel
            key={`${pubkey}:${hash}`}
            paymentHash={hash.toLowerCase()}
          />
        ) : null}
      </PaymentReceiptLayout>
    </div>
  )
}
