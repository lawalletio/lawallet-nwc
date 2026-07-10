'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  AmountKeypad,
  parseKeypadValue
} from '@/components/wallet/shared/amount-keypad'
import { AmountDisplay } from '@/components/wallet/shared/amount-display'
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
import {
  useActiveCurrencies,
  type Currency
} from '@/lib/client/currencies-store'
import { getDomainAvatarUrl } from '@/lib/client/lightning-address-suggestions'
import {
  convertSats,
  useYadioRates,
  type BtcRates
} from '@/lib/client/use-yadio-ticker'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'
import { cn } from '@/lib/utils'

interface RecipientDetails {
  displayName: string
  subtitle: string
  avatarUrl: string | null
  loading: boolean
}

interface LightweightProfile {
  name?: string | null
  image?: string | null
}

export function SendAmountStep() {
  const router = useRouter()
  const flow = useSendFlow()
  const contacts = useContacts()
  const activeCurrencies = useActiveCurrencies()
  const { rates } = useYadioRates()
  const initialCurrencyCode = activeCurrencies[0]?.code ?? 'SAT'
  const [canonicalAmount, setCanonicalAmount] = useState<number | null>(null)
  const [value, setValue] = useState<string>('0')
  const [valuesByCurrency, setValuesByCurrency] = useState<
    Record<string, string>
  >(() => ({
    [initialCurrencyCode]: '0'
  }))
  const [currencyCode, setCurrencyCode] = useState<string>(initialCurrencyCode)
  const [details, setDetails] = useState<RecipientDetails | null>(null)
  const savedContact = useMemo(() => {
    const address = getLightningAddress(flow.recipient)
    if (!address) return null
    return (
      contacts.find(contact => contact.lightningAddress === address) ?? null
    )
  }, [contacts, flow.recipient])

  const baseDetails = useMemo(
    () => buildRecipientDetails(flow.recipient, savedContact),
    [flow.recipient, savedContact]
  )

  useEffect(() => {
    if (!flow.recipient) {
      router.replace('/wallet/send')
      return
    }
    sendActions.setAmount(null)
    trackEvent(AnalyticsEvent.WALLET_SEND_STARTED)
    // Recipient is captured by the parent route; the started event
    // belongs here because this is the first step where the user can
    // actually commit to sending. Fire once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!flow.recipient || !baseDetails) return
    let cancelled = false
    const address = getLightningAddress(flow.recipient)

    setDetails(baseDetails)

    if (!address || flow.recipient.destination.kind !== 'lnurl-pay') return

    setDetails({ ...baseDetails, loading: true })

    void Promise.all([
      fetchLud16Profile(flow.recipient.destination.lnurlpUrl),
      contactsActions.hydrateNip05Profile(address)
    ]).then(([lud16Profile, nip05Contact]) => {
      if (cancelled) return

      const displayName = firstUseful(
        nip05Contact?.displayName,
        nip05Contact?.name,
        lud16Profile?.name,
        baseDetails.displayName
      )
      const profileAvatarUrl =
        nip05Contact?.avatarUrl ?? lud16Profile?.image ?? null
      const avatarUrl = profileAvatarUrl ?? baseDetails.avatarUrl

      setDetails({
        ...baseDetails,
        displayName,
        avatarUrl,
        loading: false
      })

      if (displayName || avatarUrl || nip05Contact) {
        contactsActions.upsertRecent({
          lightningAddress: address,
          name: displayName,
          displayName:
            firstUseful(nip05Contact?.displayName, nip05Contact?.name) ??
            undefined,
          pubkey: nip05Contact?.pubkey ?? undefined,
          npub: nip05Contact?.npub ?? undefined,
          avatarUrl: profileAvatarUrl ?? undefined,
          profileFetchedAt: nip05Contact?.profileFetchedAt ?? undefined,
          touch: false
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [baseDetails, flow.recipient])

  const displayCurrency =
    activeCurrencies.find(currency => currency.code === currencyCode) ??
    activeCurrencies[0]
  const selectedCode = displayCurrency?.code ?? 'SAT'
  const displayAmount = value
  const displayUnit =
    displayCurrency?.code === 'SAT' ? 'sats' : (displayCurrency?.code ?? 'sats')
  const keypadUsesInteger = selectedCode === 'SAT'
  const keypadUsesFixedDecimals =
    selectedCode !== 'SAT' && selectedCode !== 'BTC'
  const fixedDecimalDigits = keypadUsesFixedDecimals ? 2 : undefined
  const maxDecimalDigits = selectedCode === 'BTC' ? 8 : undefined

  useEffect(() => {
    if (activeCurrencies.some(currency => currency.code === currencyCode)) {
      return
    }
    const fallbackCode = activeCurrencies[0]?.code ?? 'SAT'
    const fallbackValue =
      valuesByCurrency[fallbackCode] ??
      formatInputFromSats(canonicalAmount, fallbackCode, rates)
    setValue(fallbackValue)
    setValuesByCurrency(prev => ({
      ...prev,
      [fallbackCode]: fallbackValue
    }))
    setCurrencyCode(fallbackCode)
  }, [activeCurrencies, canonicalAmount, currencyCode, rates, valuesByCurrency])

  function handleAmountChange(nextValue: string) {
    setValue(nextValue)
    setValuesByCurrency({
      [currencyCode]: nextValue
    })
    setCanonicalAmount(parseAmountToSats(nextValue, currencyCode, rates))
  }

  function handleCurrencyChange(nextCode: string) {
    const nextValue =
      valuesByCurrency[nextCode] ??
      formatInputFromSats(canonicalAmount, nextCode, rates)
    setValue(nextValue)
    setValuesByCurrency(prev => ({
      ...prev,
      [nextCode]: nextValue
    }))
    setCurrencyCode(nextCode)
  }

  function next() {
    if (canonicalAmount === null) return
    sendActions.setAmount(canonicalAmount)
    router.push('/wallet/send/preview')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-5">
      {details && <RecipientPreview details={details} />}

      <div className="flex min-h-0 flex-1 flex-col justify-between gap-5">
        <div className="flex flex-col items-center gap-3">
          <AmountDisplay
            value={displayAmount}
            unit={displayUnit}
            className="py-1 pt-2"
          />
          <AmountCurrencyToggle
            currencies={activeCurrencies}
            value={selectedCode}
            onChange={handleCurrencyChange}
          />
        </div>

        <AmountKeypad
          value={value}
          onChange={handleAmountChange}
          integerOnly={keypadUsesInteger}
          fixedDecimalDigits={fixedDecimalDigits}
          maxDecimalDigits={maxDecimalDigits}
          className="min-h-0 flex-1 grid-rows-4 gap-3"
          buttonClassName="h-full min-h-[58px] rounded-2xl bg-card/90 text-3xl"
        />
      </div>

      <div className="pt-1">
        <Button
          type="button"
          onClick={next}
          disabled={canonicalAmount === null}
          className="h-12 w-full"
        >
          Continue
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function AmountCurrencyToggle({
  currencies,
  value,
  onChange
}: {
  currencies: Currency[]
  value: string
  onChange: (next: string) => void
}) {
  if (currencies.length <= 1) return null

  return (
    <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-card p-1">
      {currencies.map(currency => {
        const active = value === currency.code
        const label = currency.code === 'SAT' ? 'sats' : currency.code
        return (
          <button
            key={currency.code}
            type="button"
            onClick={() => onChange(currency.code)}
            className={cn(
              'shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function RecipientPreview({ details }: { details: RecipientDetails }) {
  return (
    <section className="rounded-3xl border border-border/70 bg-card/80 p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <Avatar className="size-14 border border-border/70 bg-background">
          {details.avatarUrl && (
            <AvatarImage
              src={details.avatarUrl}
              alt=""
              className="object-cover"
            />
          )}
          <AvatarFallback>{initialsFor(details.displayName)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            To
          </p>
          <p className="truncate text-base font-semibold text-foreground">
            {details.displayName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {details.subtitle}
          </p>
        </div>
      </div>
    </section>
  )
}

function buildRecipientDetails(
  recipient: ResolvedRecipient | null,
  savedContact: Contact | null
): RecipientDetails | null {
  if (!recipient) return null
  const address = getLightningAddress(recipient)
  const domain = getRecipientDomain(recipient)
  const fallbackAvatar = domain ? getDomainAvatarUrl(domain) : null
  const displayName = firstUseful(
    savedContact?.displayName,
    savedContact?.name,
    recipient.profile?.name,
    address ? address.split('@')[0] : recipient.raw
  )

  return {
    displayName,
    subtitle: address ?? labelForRecipient(recipient),
    avatarUrl:
      savedContact?.avatarUrl ?? recipient.profile?.image ?? fallbackAvatar,
    loading: Boolean(
      address && (!recipient.profile?.name || !recipient.profile?.image)
    )
  }
}

function parseAmountToSats(
  raw: string,
  code: string,
  rates: BtcRates | null
): number | null {
  const value = parseKeypadValue(raw)
  if (value === null) return null
  if (code === 'SAT') return ceilPositiveSats(value)
  if (code === 'BTC') {
    return ceilPositiveSats(value * 100_000_000)
  }
  if (!rates) return null
  const rate = rates[code]
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    return null
  }
  return ceilPositiveSats((value / rate) * 100_000_000)
}

function formatInputFromSats(
  sats: number | null,
  code: string,
  rates: BtcRates | null
): string {
  if (!sats || sats <= 0) return '0'
  if (code === 'SAT') return String(Math.trunc(sats))

  const converted = convertSats(sats, code, rates)
  if (converted === null) return '0'

  return code === 'BTC' ? trimFixed(converted, 8) : formatFiatInput(converted)
}

function ceilPositiveSats(rawSats: number): number | null {
  if (!Number.isFinite(rawSats) || rawSats <= 0) return null
  const rounded = Math.round(rawSats)
  const sats = Math.abs(rawSats - rounded) < 1e-9 ? rounded : Math.ceil(rawSats)
  return Math.max(1, sats)
}

function formatFiatInput(value: number): string {
  const displayValue = value > 0 && value < 0.01 ? 0.01 : value
  return displayValue.toFixed(2)
}

function trimFixed(value: number, digits: number): string {
  const fixed = value.toFixed(digits)
  const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return trimmed || '0'
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

async function fetchLud16Profile(
  lnurlpUrl: string
): Promise<LightweightProfile | null> {
  try {
    const res = await fetch(lnurlpUrl, {
      headers: { accept: 'application/json' }
    })
    if (!res.ok) return null
    const meta = await res.json()
    if (!meta || typeof meta.metadata !== 'string') return null
    const metaArr = safeParseMetadata(meta.metadata)
    const textPlain = metaArr.find(
      ([k]) => k === 'text/plain' || k === 'text/identifier'
    )?.[1]
    const imageEntry = metaArr.find(([k]) => k.startsWith('image/'))
    return {
      name: textPlain,
      image: imageEntry ? `data:${imageEntry[0]};base64,${imageEntry[1]}` : null
    }
  } catch {
    return null
  }
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

function safeParseMetadata(raw: string): Array<[string, string]> {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter(
          (p): p is [string, string] => Array.isArray(p) && p.length >= 2
        )
      : []
  } catch {
    return []
  }
}
