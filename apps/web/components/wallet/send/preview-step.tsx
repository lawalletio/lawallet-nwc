'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { useApi } from '@/lib/client/hooks/use-api'
import { resolveUserNwc } from '@/lib/client/wallet-nwc'
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
  const flow = useSendFlow()
  const contacts = useContacts()
  const activeCurrencies = useActiveCurrencies()
  const { rates } = useYadioRates()
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
        hydratedContactForRecipient ?? savedContact
      ),
    [flow.recipient, hydratedContactForRecipient, savedContact]
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
        const message = err instanceof Error ? err.message : 'Quote failed'
        if (!cancelled)
          setQuoteState({ key: quoteKey, status: 'error', message })
      }
    )

    return () => {
      cancelled = true
    }
  }, [quoteKey, flow.recipient, flow.amountSats, flow.comment])

  if (!flow.recipient || flow.amountSats === null) return null

  const recipientLabel =
    recipientDetails?.displayName ??
    flow.recipient.profile?.name ??
    flow.recipient.raw
  const canPay = Boolean(
    effectiveNwc && currentQuote.status === 'ready' && !paying
  )
  const paymentButtonLabel =
    currentQuote.status === 'ready'
      ? `Pay ${currentQuote.quote.amountSats.toLocaleString()} sats`
      : currentQuote.status === 'error'
        ? 'Quote unavailable'
        : 'Quoting payment...'

  async function confirm() {
    if (paying) return
    if (!effectiveNwc) {
      toast.error('No wallet connected')
      return
    }
    if (currentQuote.status !== 'ready') {
      toast.error(
        currentQuote.status === 'error'
          ? currentQuote.message
          : 'Preparing payment quote'
      )
      return
    }
    setPaying(true)
    try {
      const result = await payQuotedInvoice(effectiveNwc, currentQuote.quote)
      sendActions.setResult({
        preimage: result.preimage,
        feesPaidSats: result.feesPaidSats,
        amountSats: flow.amountSats!,
        recipient: recipientLabel
      })
      router.replace('/wallet/send/summary')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment failed'
      sendActions.setError(message)
      toast.error(message)
      setPaying(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-y-contain pb-4 pt-4 [scrollbar-gutter:stable]">
        <section className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--theme-300)] to-transparent" />

          <div className="flex flex-col items-center gap-2 px-5 pb-7 pt-6 text-center">
            <span className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
              Sending
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
                    To
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
                  label="Type"
                  value={labelForKind(flow.recipient.destination.kind)}
                />
                {flow.comment && (
                  <>
                    <div className="my-3 border-t border-border/60" />
                    <DetailRow label="Note" value={flow.comment} />
                  </>
                )}
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
            <DetailRow label="To" value={recipientLabel} />
            <div className="my-3 border-t border-border/60" />
            <DetailRow
              label="Type"
              value={labelForKind(flow.recipient.destination.kind)}
            />
          </div>
        )}

        {flow.comment && !recipientDetails && (
          <div className="rounded-2xl border border-border bg-card p-4">
            <DetailRow label="Note" value={flow.comment} />
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
              ? 'Quoting payment...'
              : 'Swipe to pay'
          }
          activeLabel="Release to confirm"
          loadingLabel="Paying..."
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
            Paying...
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
  const quotedAmount =
    state.status === 'ready' ? state.quote.amountSats : amountSats
  const feeSats = state.status === 'ready' ? state.quote.feeSats : null
  const totalSats = quotedAmount + (feeSats ?? 0)
  const feeText =
    state.status === 'loading'
      ? 'Quoting...'
      : state.status === 'error'
        ? 'Unavailable'
        : feeSats === null
          ? 'Not quoted by wallet'
          : `${feeSats.toLocaleString()} sats`
  const totalText =
    state.status === 'ready' && feeSats !== null
      ? `${totalSats.toLocaleString()} sats`
      : `${quotedAmount.toLocaleString()} sats + fee`

  return (
    <section className="rounded-3xl border border-border/80 bg-card/85 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Quote
          </p>
          <p className="text-sm font-medium text-foreground">Before sending</p>
        </div>
        <QuoteStatus state={state} />
      </div>

      <div className="mt-4 rounded-2xl border border-border/70 bg-background/35 p-3">
        <QuoteLine
          label="Amount"
          value={`${quotedAmount.toLocaleString()} sats`}
        />
        <div className="my-3 border-t border-border/60" />
        <QuoteLine
          label="Network fee"
          value={feeText}
          muted={feeSats === null}
        />
        <div className="my-3 border-t border-border/60" />
        <QuoteLine label="Total" value={totalText} strong />
      </div>

      {state.status === 'ready' && state.quote.feeSats === null && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {state.quote.feeQuoteMessage}
        </p>
      )}
      {state.status === 'error' && (
        <p className="mt-2 text-xs leading-relaxed text-destructive">
          {state.message}
        </p>
      )}

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Equivalents
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
  if (state.status === 'loading') {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs font-semibold text-muted-foreground">
        <Spinner size={12} />
        Quoting
      </span>
    )
  }

  if (state.status === 'error') {
    return (
      <span className="rounded-full bg-destructive/15 px-3 py-1 text-xs font-semibold text-destructive">
        Failed
      </span>
    )
  }

  return (
    <span className="rounded-full border border-[var(--theme-300)] bg-[var(--theme-400)]/20 px-3 py-1 text-xs font-semibold text-foreground">
      Ready
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
  contact: Contact | null
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
    subtitle: address ?? labelForRecipient(recipient),
    avatarUrl: contact?.avatarUrl ?? recipient.profile?.image ?? fallbackAvatar
  }
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

function labelForRecipient(recipient: ResolvedRecipient): string {
  switch (recipient.destination.kind) {
    case 'invoice':
      return 'Lightning invoice'
    case 'lnurl-pay':
      return 'Lightning address'
    case 'npub':
      return 'Nostr profile'
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

function labelForKind(kind: string): string {
  switch (kind) {
    case 'invoice':
      return 'Lightning invoice'
    case 'lnurl-pay':
      return 'Lightning address'
    case 'npub':
      return 'Nostr zap'
    default:
      return kind
  }
}
