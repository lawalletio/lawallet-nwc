'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { AmountKeypad } from '@/components/wallet/shared/amount-keypad'
import { AmountDisplay } from '@/components/wallet/shared/amount-display'
import { CurrencyToggle } from '@/components/wallet/shared/currency-toggle'
import { useAmountCurrencyInput } from '@/components/wallet/shared/use-amount-currency-input'
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
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

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
  const {
    value,
    onAmountChange,
    currencyCode,
    onCurrencyChange,
    canonicalAmount,
    displayUnit,
    activeCurrencies,
    integerOnly,
    fixedDecimalDigits,
    maxDecimalDigits
  } = useAmountCurrencyInput()
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
  const recipientAddress = getLightningAddress(flow.recipient)
  const lnurlpUrl =
    flow.recipient?.destination.kind === 'lnurl-pay'
      ? flow.recipient.destination.lnurlpUrl
      : null

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
    if (!baseDetails) return
    let cancelled = false
    const address = recipientAddress
    const snapshot = baseDetails

    setDetails(snapshot)

    if (!address || !lnurlpUrl) return

    setDetails({ ...snapshot, loading: true })

    void Promise.all([
      fetchLud16Profile(lnurlpUrl),
      contactsActions.hydrateNip05Profile(address)
    ]).then(([lud16Profile, nip05Contact]) => {
      if (cancelled) return

      const displayName = firstUseful(
        nip05Contact?.displayName,
        nip05Contact?.name,
        lud16Profile?.name,
        snapshot.displayName
      )
      const profileAvatarUrl =
        nip05Contact?.avatarUrl ?? lud16Profile?.image ?? null
      const avatarUrl = profileAvatarUrl ?? snapshot.avatarUrl

      setDetails({
        ...snapshot,
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
    // Depend on the recipient's stable identity, not `baseDetails`.
    // upsertRecent always allocates a new Contact, which would otherwise
    // rebuild baseDetails and re-fetch forever (#178).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientAddress, lnurlpUrl])

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
            value={value}
            unit={displayUnit}
            className="py-1 pt-2"
          />
          <CurrencyToggle
            currencies={activeCurrencies}
            value={currencyCode}
            onChange={onCurrencyChange}
          />
        </div>

        <AmountKeypad
          value={value}
          onChange={onAmountChange}
          integerOnly={integerOnly}
          fixedDecimalDigits={fixedDecimalDigits}
          maxDecimalDigits={maxDecimalDigits}
          onSubmit={next}
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
