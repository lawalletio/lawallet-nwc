'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { invalidateApiPath, useApi } from '@/lib/client/hooks/use-api'
import { resolveFreshUserNwc, resolveUserNwc } from '@/lib/client/wallet-nwc'
import { useAuth } from '@/components/admin/auth-context'
import {
  useSendFlow,
  sendActions,
  type ResolvedRecipient
} from '@/lib/client/wallet-flow-store'
import {
  contactsActions,
  useContacts,
  type Contact
} from '@/lib/client/contacts-store'
import { getDomainAvatarUrl } from '@/lib/client/lightning-address-suggestions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { SwipeButton } from '@/components/ui/swipe-button'
import {
  payQuotedInvoice,
  quotePayment,
  type PaymentQuote
} from '@/lib/client/nwc'
import { paymentHashFromBolt11 } from '@/lib/client/payment-receipt'
import {
  useActiveCurrencies,
  type Currency
} from '@/lib/client/currencies-store'
import {
  convertSats,
  useYadioRates,
  type BtcRates
} from '@/lib/client/use-yadio-ticker'
import { cn } from '@/lib/utils'
import { useT, type Dict } from '@/lib/client/i18n'
import { errorText, nwcErrorText } from '@/lib/client/i18n/errors'

interface UserMeResponse {
  effectiveNwcString: string | null
  nwcString: string
}

interface RecipientPreviewDetails {
  displayName: string
  subtitle: string
  avatarUrl: string | null
}

type QuoteState =
  | { key: string; status: 'ready'; quote: PaymentQuote }
  | { key: string; status: 'error'; message: string }

type CurrentQuoteState =
  | { status: 'loading' }
  | { status: 'ready'; quote: PaymentQuote }
  | { status: 'error'; message: string }

export function SendPreviewStep() {
  const router = useRouter()
  const t = useT()
  const flow = useSendFlow()
  const contacts = useContacts()
  const activeCurrencies = useActiveCurrencies()
  const { rates } = useYadioRates()
  const { apiClient } = useAuth()
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const effectiveNwc = resolveUserNwc(me)
  const [paying, setPaying] = useState(false)
  const [hydratedContact, setHydratedContact] = useState<Contact | null>(null)
  const [quoteState, setQuoteState] = useState<QuoteState | null>(null)
  const lightningAddress = getLightningAddress(flow.recipient)
  const quoteKey =
    flow.recipient && flow.amountSats !== null
      ? [
          flow.recipient.raw,
          flow.recipient.destination.kind,
          flow.amountSats,
          flow.comment
        ].join('|')
      : null
  const savedContact = useMemo(() => {
    if (!lightningAddress) return null
    return (
      contacts.find(contact => contact.lightningAddress === lightningAddress) ??
      null
    )
  }, [contacts, lightningAddress])
  const hydratedContactForRecipient =
    hydratedContact?.lightningAddress === lightningAddress
      ? hydratedContact
      : null
  const recipientDetails = useMemo(
    () =>
      buildRecipientDetails(
        flow.recipient,
        hydratedContactForRecipient ?? savedContact,
        t
      ),
    [flow.recipient, hydratedContactForRecipient, savedContact, t]
  )
  const currentQuote = useMemo<CurrentQuoteState>(() => {
    if (!quoteKey || quoteState?.key !== quoteKey) {
      return { status: 'loading' }
    }
    if (quoteState.status === 'ready') {
      return { status: 'ready', quote: quoteState.quote }
    }
    return { status: 'error', message: quoteState.message }
  }, [quoteKey, quoteState])

  useEffect(() => {
    if (!flow.recipient || flow.amountSats === null) {
      router.replace('/wallet/send')
    }
  }, [flow.recipient, flow.amountSats, router])

  // Enter mirrors the pay button for keyboard users. Ref keeps the
  // listener subscribed once while always calling the latest confirm.
  const confirmRef = useRef<() => void>(() => {})

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      // Focused buttons/links fire their own click on Enter.
      if (target?.closest('button, a')) return
      event.preventDefault()
      confirmRef.current()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!lightningAddress || flow.recipient?.destination.kind !== 'lnurl-pay') {
      return
    }

    let cancelled = false

    void contactsActions.hydrateNip05Profile(lightningAddress).then(contact => {
      if (!cancelled) setHydratedContact(contact)
    })

    return () => {
      cancelled = true
    }
  }, [flow.recipient, lightningAddress])

  useEffect(() => {
    if (!quoteKey || !flow.recipient || flow.amountSats === null) return

    let cancelled = false

    void quotePayment(
      flow.recipient.destination,
      flow.amountSats,
      flow.comment || undefined
    ).then(
      quote => {
        if (!cancelled) setQuoteState({ key: quoteKey, status: 'ready', quote })
      },
      err => {
        const message = errorText(t, err, t.send.preview.quoteFailed)
        if (!cancelled)
          setQuoteState({ key: quoteKey, status: 'error', message })
      }
    )

    return () => {
      cancelled = true
    }
  }, [quoteKey, flow.recipient, flow.amountSats, flow.comment, t])

  const typedNote = flow.comment.trim()
  const acceptedNote =
    currentQuote.status === 'ready'
      ? currentQuote.quote.comment
      : typedNote || null
  const noteOmitted =
    currentQuote.status === 'ready' &&
    typedNote.length > 0 &&
    !currentQuote.quote.comment
  const recipientLabel =
    recipientDetails?.displayName ??
    flow.recipient?.profile?.name ??
    flow.recipient?.raw ??
    ''
  const canPay = Boolean(
    effectiveNwc && currentQuote.status === 'ready' && !paying
  )
  const paymentButtonLabel =
    currentQuote.status === 'ready'
      ? t.send.preview.pay(currentQuote.quote.amountSats.toLocaleString())
      : currentQuote.status === 'error'
        ? t.send.preview.quoteUnavailable
        : t.send.preview.quotingPayment

  async function confirm() {
    if (paying) return
    if (currentQuote.status !== 'ready') {
      toast.error(
        currentQuote.status === 'error'
          ? currentQuote.message
          : t.send.preview.preparingQuote
      )
      return
    }
    setPaying(true)
    try {
      const nwc = await resolveFreshUserNwc(
        () => apiClient.get<UserMeResponse>('/api/users/me'),
        effectiveNwc
      )
      invalidateApiPath('/api/users/me')
      if (!nwc) {
        toast.error(t.send.preview.noWallet)
        setPaying(false)
        return
      }
      const result = await payQuotedInvoice(nwc, currentQuote.quote)
      sendActions.setResult({
        preimage: result.preimage,
        feesPaidSats: result.feesPaidSats,
        amountSats: flow.amountSats!,
        recipient: recipientLabel,
        paymentHash: paymentHashFromBolt11(currentQuote.quote.paymentRequest),
        destination: destinationForReceipt(flow.recipient),
        comment: currentQuote.quote.comment,
        settledAt: Date.now()
      })
      router.replace('/wallet/send/summary')
    } catch (err) {
      const message = nwcErrorText(t, err, t.send.preview.paymentFailed)
      sendActions.setError(message)
      toast.error(message)
      setPaying(false)
    }
  }

  useEffect(() => {
    confirmRef.current = () => {
      if (!canPay) return
      void confirm()
    }
  })

  if (!flow.recipient || flow.amountSats === null) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-y-contain pb-4 pt-4 scrollbar-gutter-stable">
        <section className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-(--theme-300) to-transparent" />

          <div className="flex flex-col items-center gap-2 px-5 pb-7 pt-6 text-center">
            <span className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              {t.send.preview.sending}
            </span>
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className="text-6xl font-semibold leading-none text-foreground">
                {flow.amountSats.toLocaleString()}
              </span>
              <span className="text-xl font-semibold text-muted-foreground">
                sats
              </span>
            </div>
          </div>

          {recipientDetails && (
            <div className="border-t border-border/70 bg-background/35 p-4">
              <div className="flex items-center gap-3">
                <Avatar className="size-16 border border-border/70 bg-background">
                  {recipientDetails.avatarUrl && (
                    <AvatarImage
                      src={recipientDetails.avatarUrl}
                      alt=""
                      className="object-cover"
                    />
                  )}
                  <AvatarFallback>
                    {initialsFor(recipientDetails.displayName)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    {t.send.to}
                  </p>
                  <p className="truncate text-xl font-semibold text-foreground">
                    {recipientDetails.displayName}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">
                    {recipientDetails.subtitle}
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-border/70 bg-card/70 p-3">
                <DetailRow
                  label={t.send.preview.type}
                  value={labelForKind(flow.recipient.destination.kind, t)}
                />
                <PaymentNote comment={acceptedNote} omitted={noteOmitted} />
              </div>
            </div>
          )}
        </section>

        <PaymentQuotePanel
          amountSats={flow.amountSats}
          currencies={activeCurrencies}
          rates={rates}
          state={currentQuote}
        />

        {!recipientDetails && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <DetailRow label={t.send.to} value={recipientLabel} />
            <div className="my-3 border-t border-border/60" />
            <DetailRow
              label={t.send.preview.type}
              value={labelForKind(flow.recipient.destination.kind, t)}
            />
            <PaymentNote comment={acceptedNote} omitted={noteOmitted} />
          </div>
        )}

        {flow.error && (
          <p className="text-center text-sm text-destructive">{flow.error}</p>
        )}
      </div>

      <div className="relative z-10 -mx-4 shrink-0 border-t border-border/60 bg-background/90 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:mx-0 sm:border-t-0 sm:bg-transparent sm:px-0 sm:pb-6 sm:pt-4 sm:backdrop-blur-none">
        <SwipeButton
          className="sm:hidden"
          label={
            currentQuote.status === 'loading'
              ? t.send.preview.quotingPayment
              : t.send.preview.swipeToPay
          }
          activeLabel={t.send.preview.releaseToConfirm}
          loadingLabel={t.send.preview.paying}
          onConfirm={confirm}
          disabled={!canPay}
        />

        <Button
          type="button"
          variant="theme"
          onClick={confirm}
          disabled={!canPay}
          className="relative hidden h-14 w-full overflow-hidden rounded-full text-base font-semibold sm:inline-flex"
        >
          <span
            className={cn(
              'flex items-center gap-2 transition-opacity duration-200',
              paying ? 'opacity-0' : 'opacity-100'
            )}
          >
            {currentQuote.status === 'loading' && <Spinner size={16} />}
            {paymentButtonLabel}
            {currentQuote.status === 'ready' && (
              <ArrowRight className="size-5" />
            )}
          </span>
          <span
            className={cn(
              'absolute inset-0 flex items-center justify-center gap-2 transition-opacity duration-200',
              paying ? 'opacity-100' : 'opacity-0'
            )}
          >
            <Spinner size={16} />
            {t.send.preview.paying}
          </span>
        </Button>
      </div>
    </div>
  )
}

function PaymentQuotePanel({
  amountSats,
  currencies,
  rates,
  state
}: {
  amountSats: number
  currencies: Currency[]
  rates: BtcRates | null
  state: CurrentQuoteState
}) {
  const t = useT()
  const quotedAmount =
    state.status === 'ready' ? state.quote.amountSats : amountSats
  const feeSats = state.status === 'ready' ? state.quote.feeSats : null
  const totalSats = quotedAmount + (feeSats ?? 0)
  const feeText =
    state.status === 'loading'
      ? t.send.preview.feeQuoting
      : state.status === 'error'
        ? t.send.preview.feeUnavailable
        : feeSats === null
          ? t.send.preview.feeNotQuoted
          : t.common.sats(feeSats.toLocaleString())
  const totalText =
    state.status === 'ready' && feeSats !== null
      ? t.common.sats(totalSats.toLocaleString())
      : t.send.preview.plusFee(quotedAmount.toLocaleString())

  return (
    <section className="rounded-3xl border border-border/80 bg-card/85 p-4 shadow-xs">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {t.send.preview.quote}
          </p>
          <p className="text-sm font-medium text-foreground">
            {t.send.preview.beforeSending}
          </p>
        </div>
        <QuoteStatus state={state} />
      </div>

      <div className="mt-4 rounded-2xl border border-border/70 bg-background/35 p-3">
        <QuoteLine
          label={t.send.preview.amount}
          value={t.common.sats(quotedAmount.toLocaleString())}
        />
        <div className="my-3 border-t border-border/60" />
        <QuoteLine
          label={t.send.networkFee}
          value={feeText}
          muted={feeSats === null}
        />
        <div className="my-3 border-t border-border/60" />
        <QuoteLine label={t.send.preview.total} value={totalText} strong />
      </div>

      {state.status === 'ready' && state.quote.feeSats === null && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {t.send.preview.feeQuoteUnavailable}
        </p>
      )}
      {state.status === 'error' && (
        <p className="mt-2 text-xs leading-relaxed text-destructive">
          {state.message}
        </p>
      )}

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {t.send.preview.equivalents}
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {currencies.map(currency => (
            <div
              key={currency.code}
              className="min-w-0 rounded-xl border border-border/60 bg-background/30 px-2.5 py-2"
            >
              <p className="truncate text-[10px] font-semibold uppercase text-muted-foreground">
                {currency.code === 'SAT' ? 'sats' : currency.code}
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-foreground">
                {formatEquivalent(quotedAmount, currency.code, rates)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function QuoteStatus({ state }: { state: CurrentQuoteState }) {
  const t = useT()
  if (state.status === 'loading') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
        <Spinner size={12} />
        {t.send.preview.statusQuoting}
      </span>
    )
  }

  if (state.status === 'error') {
    return (
      <span className="rounded-full bg-destructive/15 px-3 py-1 text-xs font-semibold text-destructive">
        {t.send.preview.statusFailed}
      </span>
    )
  }

  return (
    <span className="rounded-full border border-(--theme-300) bg-(--theme-400)/20 px-3 py-1 text-xs font-semibold text-foreground">
      {t.send.preview.statusReady}
    </span>
  )
}

function QuoteLine({
  label,
  muted = false,
  strong = false,
  value
}: {
  label: string
  muted?: boolean
  strong?: boolean
  value: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'max-w-[64%] truncate text-right font-medium',
          muted ? 'text-muted-foreground' : 'text-foreground',
          strong && 'font-semibold'
        )}
      >
        {value}
      </span>
    </div>
  )
}

function PaymentNote({
  comment,
  omitted
}: {
  comment: string | null
  omitted: boolean
}) {
  const t = useT()
  if (!comment && !omitted) return null
  return (
    <>
      <div className="my-3 border-t border-border/60" />
      {comment ? (
        <DetailRow label={t.send.note} value={comment} />
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t.send.preview.noteOmitted}
        </p>
      )}
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="max-w-[62%] break-all text-right font-medium text-foreground">
        {value}
      </span>
    </div>
  )
}

function formatEquivalent(
  sats: number,
  code: string,
  rates: BtcRates | null
): string {
  const value = convertSats(sats, code, rates)
  if (value === null) return '...'
  if (code === 'SAT') return Math.round(value).toLocaleString()
  if (code === 'BTC') return trimFixed(value, 8)

  const maximumFractionDigits = Math.abs(value) >= 100 ? 0 : 2
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits
  })
}

function trimFixed(value: number, digits: number): string {
  const fixed = value.toFixed(digits)
  const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return trimmed || '0'
}

function buildRecipientDetails(
  recipient: ResolvedRecipient | null,
  contact: Contact | null,
  t: Dict
): RecipientPreviewDetails | null {
  if (!recipient) return null
  const address = getLightningAddress(recipient)
  const domain = getRecipientDomain(recipient)
  const fallbackAvatar = domain ? getDomainAvatarUrl(domain) : null
  const displayName = firstUseful(
    contact?.displayName,
    contact?.name,
    recipient.profile?.name,
    address ? address.split('@')[0] : recipient.raw
  )

  return {
    displayName,
    subtitle: address ?? labelForRecipient(recipient, t),
    avatarUrl: contact?.avatarUrl ?? recipient.profile?.image ?? fallbackAvatar
  }
}

function destinationForReceipt(
  recipient: ResolvedRecipient | null
): string | null {
  if (!recipient) return null
  if (recipient.destination.kind === 'lnurl-pay') {
    return recipient.destination.address ?? recipient.raw
  }
  if (recipient.destination.kind === 'invoice') {
    return recipient.destination.description
  }
  return recipient.raw
}

function getLightningAddress(
  recipient: ResolvedRecipient | null
): string | null {
  if (recipient?.destination.kind !== 'lnurl-pay') return null
  return recipient.destination.address
}

function getRecipientDomain(
  recipient: ResolvedRecipient | null
): string | null {
  if (recipient?.destination.kind !== 'lnurl-pay') return null
  if (recipient.destination.host) return recipient.destination.host
  return typeof recipient.destination.address === 'string'
    ? (recipient.destination.address.split('@')[1] ?? null)
    : null
}

function firstUseful(...values: Array<string | null | undefined>): string {
  return values.find(value => value?.trim())?.trim() ?? ''
}

function labelForRecipient(recipient: ResolvedRecipient, t: Dict): string {
  switch (recipient.destination.kind) {
    case 'invoice':
      return t.send.kind.invoice
    case 'lnurl-pay':
      return t.send.kind.address
    case 'npub':
      return t.send.kind.nostrProfile
    default:
      return recipient.raw
  }
}

function initialsFor(source: string): string {
  const parts = source
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const second = parts.length > 1 ? parts[1]?.[0] : parts[0]?.[1]
  return `${first}${second ?? ''}`.toUpperCase()
}

function labelForKind(kind: string, t: Dict): string {
  switch (kind) {
    case 'invoice':
      return t.send.kind.invoice
    case 'lnurl-pay':
      return t.send.kind.address
    case 'npub':
      return t.send.kind.nostrZap
    default:
      return kind
  }
}
