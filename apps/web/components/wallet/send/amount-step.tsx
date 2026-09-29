'use client'

import { useState, useEffect, useMemo, useRef, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
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
  const [note, setNote] = useState(flow.comment)
  const [commentAllowed, setCommentAllowed] = useState<number | null>(() =>
    flow.recipient?.destination.kind === 'lnurl-pay' ? null : 0
  )
  const noteRef = useRef<HTMLInputElement>(null)
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

    if (!lnurlpUrl) {
      setCommentAllowed(0)
      return
    }

    if (address) setDetails({ ...snapshot, loading: true })

    void Promise.all([
      fetchPayRequest(lnurlpUrl),
      address
        ? contactsActions.hydrateNip05Profile(address)
        : Promise.resolve(null)
    ]).then(([payRequest, nip05Contact]) => {
      if (cancelled) return
      setCommentAllowed(payRequest.commentAllowed)
      if (!address) return

      const lud16Profile = payRequest.profile
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

  useEffect(() => {
    if (!commentAllowed) return
    setNote(current =>
      current.length > commentAllowed ? current.slice(0, commentAllowed) : current
    )
  }, [commentAllowed])

  const showNote =
    flow.recipient?.destination.kind === 'lnurl-pay' && commentAllowed !== 0

  function next() {
    if (canonicalAmount === null) return
    if (!showNote) {
      sendActions.setComment('')
    } else if (commentAllowed && commentAllowed > 0) {
      sendActions.setComment(note.trim().slice(0, commentAllowed))
    } else {
      sendActions.setComment(note.trim())
    }
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
          noteRef={showNote ? noteRef : undefined}
          onSubmit={next}
          className="min-h-0 flex-1 grid-rows-4 gap-3"
          buttonClassName="h-full min-h-[58px] rounded-2xl bg-card/90 text-3xl"
        />
      </div>

      <div className="flex flex-col gap-3 pt-1">
        {showNote ? (
          <PayerNoteField
            noteRef={noteRef}
            value={note}
            maxLength={commentAllowed}
            onChange={setNote}
          />
        ) : null}
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

function PayerNoteField({
  noteRef,
  value,
  maxLength,
  onChange
}: {
  noteRef: RefObject<HTMLInputElement | null>
  value: string
  /** Null until the recipient's LUD-12 budget is known. */
  maxLength: number | null
  onChange: (value: string) => void
}) {
  const budget = maxLength !== null && maxLength > 0 ? maxLength : null
  const remaining = budget === null ? null : budget - value.length
  const atLimit = remaining === 0

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        ref={noteRef}
        id="send-payer-note"
        value={value}
        maxLength={budget ?? undefined}
        placeholder="Add a note (optional)"
        aria-label="Note for recipient"
        aria-describedby={
          budget === null
            ? 'send-payer-note-hint'
            : 'send-payer-note-hint send-payer-note-count'
        }
        autoComplete="off"
        autoCapitalize="sentences"
        spellCheck
        onChange={event =>
          onChange(budget === null ? event.target.value : event.target.value.slice(0, budget))
        }
        className="h-11"
      />
      <div className="flex items-baseline justify-between gap-3 px-0.5">
        <p
          id="send-payer-note-hint"
          className="text-xs text-muted-foreground"
        >
          The recipient will see this.
        </p>
        {remaining !== null && (
          <p
            id="send-payer-note-count"
            className={cn(
              'shrink-0 text-xs tabular-nums',
              atLimit
                ? 'font-medium text-foreground'
                : 'text-muted-foreground'
            )}
          >
            {value.length === 0 ? `${budget} max` : `${remaining} left`}
          </p>
        )}
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

interface PayRequestSnapshot {
  profile: LightweightProfile | null
  commentAllowed: number
}

async function fetchPayRequest(lnurlpUrl: string): Promise<PayRequestSnapshot> {
  try {
    const res = await fetch(lnurlpUrl, {
      headers: { accept: 'application/json' }
    })
    if (!res.ok) return { profile: null, commentAllowed: 0 }
    const meta = await res.json()
    const commentAllowed = normalizeCommentAllowed(meta?.commentAllowed)
    if (!meta || typeof meta.metadata !== 'string') {
      return { profile: null, commentAllowed }
    }
    const metaArr = safeParseMetadata(meta.metadata)
    const textPlain = metaArr.find(
      ([k]) => k === 'text/plain' || k === 'text/identifier'
    )?.[1]
    const imageEntry = metaArr.find(([k]) => k.startsWith('image/'))
    return {
      profile: {
        name: textPlain,
        image: imageEntry
          ? `data:${imageEntry[0]};base64,${imageEntry[1]}`
          : null
      },
      commentAllowed
    }
  } catch {
    return { profile: null, commentAllowed: 0 }
  }
}

function normalizeCommentAllowed(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.floor(value)
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
