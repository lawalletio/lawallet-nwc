'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useApi } from '@/lib/client/hooks/use-api'
import { parseDestination } from '@/lib/client/nwc/parse-destination'
import {
  sendActions,
  type ResolvedRecipient
} from '@/lib/client/wallet-flow-store'
import {
  contactsActions,
  useContacts,
  type Contact
} from '@/lib/client/contacts-store'
import {
  buildLightningAddressSuggestions,
  getDomainAvatarUrl,
  resolveCurrentLightningDomain,
  type LightningAddressSuggestion
} from '@/lib/client/lightning-address-suggestions'
import { cn } from '@/lib/utils'

const RECENT_PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const RECIPIENT_OPTIONS_ID = 'recipient-options'

interface UserMeResponse {
  lightningAddress: string | null
}

export function RecipientInput() {
  const router = useRouter()
  const contacts = useContacts()
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [highlightedOptionIndex, setHighlightedOptionIndex] = useState(-1)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const query = value.trim().toLowerCase()
  const currentDomain = resolveCurrentLightningDomain(me?.lightningAddress)
  const recentContacts = useMemo(() => {
    return contacts
      .filter(contact => {
        if (!query) return true
        return (
          contact.lightningAddress.toLowerCase().includes(query) ||
          contact.name.toLowerCase().includes(query) ||
          (contact.displayName?.toLowerCase().includes(query) ?? false)
        )
      })
      .slice(0, 5)
  }, [contacts, query])
  const suggestedAddresses = useMemo(
    () =>
      buildLightningAddressSuggestions(
        value,
        currentDomain,
        contacts.map(contact => contact.lightningAddress)
      ),
    [contacts, currentDomain, value]
  )
  const hasRecipientOptions =
    recentContacts.length > 0 || suggestedAddresses.length > 0
  const recipientOptionValues = useMemo(
    () => [
      ...recentContacts.map(contact => contact.lightningAddress),
      ...suggestedAddresses.map(suggestion => suggestion.lightningAddress)
    ],
    [recentContacts, suggestedAddresses]
  )
  const activeOptionIndex =
    highlightedOptionIndex >= 0 &&
    highlightedOptionIndex < recipientOptionValues.length
      ? highlightedOptionIndex
      : -1
  const activeOptionId =
    activeOptionIndex >= 0 ? optionId(activeOptionIndex) : undefined

  useEffect(() => {
    for (const contact of contacts.slice(0, 5)) {
      if (
        contact.profileFetchedAt &&
        Date.now() - contact.profileFetchedAt < RECENT_PROFILE_TTL_MS
      ) {
        continue
      }
      void contactsActions.hydrateNip05Profile(contact.lightningAddress)
    }
  }, [contacts])

  useEffect(() => {
    if (activeOptionIndex < 0) return
    optionRefs.current[activeOptionIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionIndex])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await submitRecipient(value)
  }

  function handleRecipientKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const optionCount = recipientOptionValues.length

    if (e.key === 'ArrowDown' && optionCount > 0) {
      e.preventDefault()
      setHighlightedOptionIndex(current =>
        nextOptionIndex(current, optionCount, 1)
      )
      return
    }

    if (e.key === 'ArrowUp' && optionCount > 0) {
      e.preventDefault()
      setHighlightedOptionIndex(current =>
        nextOptionIndex(current, optionCount, -1)
      )
      return
    }

    if (e.key === 'Enter' && activeOptionIndex >= 0) {
      e.preventDefault()
      const selectedValue = recipientOptionValues[activeOptionIndex]
      if (selectedValue) void submitRecipient(selectedValue)
      return
    }

    if (e.key === 'Escape' && activeOptionIndex >= 0) {
      e.preventDefault()
      setHighlightedOptionIndex(-1)
    }
  }

  function selectRecipientOption(nextValue: string, optionIndex: number) {
    setHighlightedOptionIndex(optionIndex)
    void submitRecipient(nextValue)
  }

  async function submitRecipient(nextValue: string) {
    const trimmedValue = nextValue.trim()
    if (!trimmedValue) return

    setValue(trimmedValue)
    setError(null)
    setLoading(true)

    try {
      const destination = parseDestination(trimmedValue)

      const recipient: ResolvedRecipient = {
        raw: trimmedValue,
        destination
      }

      // If the destination is a LUD-16 address, try to hydrate the profile
      // for a nicer preview. Best effort — a failed fetch still lets the flow
      // continue with just the raw address.
      if (
        destination.kind === 'lnurl-pay' &&
        'address' in destination &&
        destination.address
      ) {
        try {
          const res = await fetch(destination.lnurlpUrl, {
            headers: { accept: 'application/json' }
          })
          if (res.ok) {
            const meta = await res.json()
            if (meta && typeof meta.metadata === 'string') {
              const metaArr = safeParseMetadata(meta.metadata)
              const textPlain = metaArr.find(
                ([k]) => k === 'text/plain' || k === 'text/identifier'
              )?.[1]
              const imageEntry = metaArr.find(([k]) => k.startsWith('image/'))
              recipient.profile = {
                name: textPlain,
                image: imageEntry
                  ? `data:${imageEntry[0]};base64,${imageEntry[1]}`
                  : null
              }
            }
          }
        } catch {
          // ignore — best effort
        }
      }

      sendActions.setRecipient(recipient)

      if (destination.kind === 'lnurl-pay' && destination.address) {
        contactsActions.upsertRecent({
          lightningAddress: destination.address,
          name: recipient.profile?.name ?? destination.username,
          avatarUrl: recipient.profile?.image ?? undefined
        })
        void contactsActions.hydrateNip05Profile(destination.address)
      }

      // If the invoice already carries an amount, skip the keypad.
      if (
        destination.kind === 'invoice' &&
        destination.amountSats !== null &&
        destination.amountSats > 0
      ) {
        sendActions.setAmount(destination.amountSats)
        router.push('/wallet/send/preview')
      } else {
        router.push('/wallet/send/amount')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid recipient'
      setError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex min-h-0 flex-1 flex-col overflow-hidden px-4"
    >
      <div className="shrink-0 space-y-2 pb-4">
        <label
          htmlFor="recipient"
          className="text-sm font-medium text-foreground"
        >
          To
        </label>
        <Input
          id="recipient"
          role="combobox"
          value={value}
          onChange={e => {
            setValue(e.target.value)
            setError(null)
            setHighlightedOptionIndex(-1)
          }}
          onKeyDown={handleRecipientKeyDown}
          aria-autocomplete="list"
          aria-expanded={hasRecipientOptions}
          aria-controls={hasRecipientOptions ? RECIPIENT_OPTIONS_ID : undefined}
          aria-activedescendant={activeOptionId}
          placeholder="satoshi@lawallet.ar, lnbc…, lnurl…"
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-12 text-base"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {hasRecipientOptions ? (
        <section
          id={RECIPIENT_OPTIONS_ID}
          role="listbox"
          className="min-h-0 flex-1 overflow-hidden"
          aria-label="Recipient options"
          aria-busy={loading}
        >
          <div className="flex h-full flex-col gap-4 overflow-y-auto overscroll-y-contain pb-4 pr-1 [scrollbar-gutter:stable]">
            {recentContacts.length > 0 && (
              <RecipientOptionGroup title="Saved">
                {recentContacts.map((contact, index) => {
                  const optionIndex = index
                  return (
                    <RecipientOptionButton
                      key={contact.id}
                      id={optionId(optionIndex)}
                      name={contactDisplayName(contact)}
                      lightningAddress={contact.lightningAddress}
                      avatarUrl={
                        contact.avatarUrl ??
                        getAvatarFallbackForAddress(contact.lightningAddress)
                      }
                      active={activeOptionIndex === optionIndex}
                      buttonRef={node => {
                        optionRefs.current[optionIndex] = node
                      }}
                      onHighlight={() => setHighlightedOptionIndex(optionIndex)}
                      onSelect={() =>
                        selectRecipientOption(
                          contact.lightningAddress,
                          optionIndex
                        )
                      }
                      disabled={loading}
                    />
                  )
                })}
              </RecipientOptionGroup>
            )}

            {suggestedAddresses.length > 0 && (
              <RecipientOptionGroup title="Suggestions">
                {suggestedAddresses.map((suggestion, index) => {
                  const optionIndex = recentContacts.length + index
                  return (
                    <RecipientSuggestionButton
                      key={suggestion.lightningAddress}
                      id={optionId(optionIndex)}
                      suggestion={suggestion}
                      active={activeOptionIndex === optionIndex}
                      buttonRef={node => {
                        optionRefs.current[optionIndex] = node
                      }}
                      onHighlight={() => setHighlightedOptionIndex(optionIndex)}
                      onSelect={() =>
                        selectRecipientOption(
                          suggestion.lightningAddress,
                          optionIndex
                        )
                      }
                      disabled={loading}
                    />
                  )
                })}
              </RecipientOptionGroup>
            )}
          </div>
        </section>
      ) : (
        <div className="min-h-0 flex-1" />
      )}

      <div className="relative z-10 -mx-4 shrink-0 border-t border-border/60 bg-background/90 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl sm:mx-0 sm:border-t-0 sm:bg-transparent sm:px-0 sm:pb-6 sm:pt-4 sm:backdrop-blur-none">
        <Button
          type="submit"
          className="h-12 w-full"
          disabled={!value.trim() || loading}
        >
          Continue
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </form>
  )
}

function RecipientOptionGroup({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2" role="group" aria-label={title}>
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}

function RecipientSuggestionButton({
  id,
  suggestion,
  active,
  buttonRef,
  onHighlight,
  onSelect,
  disabled
}: {
  id: string
  suggestion: LightningAddressSuggestion
  active: boolean
  buttonRef: (node: HTMLButtonElement | null) => void
  onHighlight: () => void
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <RecipientOptionButton
      id={id}
      name={suggestion.lightningAddress}
      lightningAddress={suggestion.domain}
      avatarUrl={suggestion.avatarUrl}
      active={active}
      buttonRef={buttonRef}
      onHighlight={onHighlight}
      onSelect={onSelect}
      disabled={disabled}
    />
  )
}

function RecipientOptionButton({
  id,
  name,
  lightningAddress,
  avatarUrl,
  active,
  buttonRef,
  onHighlight,
  onSelect,
  disabled
}: {
  id: string
  name: string
  lightningAddress: string
  avatarUrl?: string | null
  active: boolean
  buttonRef: (node: HTMLButtonElement | null) => void
  onHighlight: () => void
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <button
      ref={buttonRef}
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={active}
      onClick={onSelect}
      onMouseEnter={onHighlight}
      disabled={disabled}
      className={cn(
        'flex min-h-[58px] w-full items-center gap-3 rounded-2xl border px-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-70',
        active
          ? 'border-[var(--theme-300)] bg-accent/80'
          : 'border-border/70 bg-card/80 hover:border-border hover:bg-card'
      )}
    >
      <Avatar className="size-10 border border-border/70">
        {avatarUrl && (
          <AvatarImage src={avatarUrl} alt="" className="object-cover" />
        )}
        <AvatarFallback>{initialsFor(name)}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {lightningAddress}
        </span>
      </span>
    </button>
  )
}

function optionId(index: number): string {
  return `recipient-option-${index}`
}

function nextOptionIndex(
  current: number,
  optionCount: number,
  direction: 1 | -1
): number {
  if (optionCount <= 0) return -1
  if (direction === 1) {
    return current < 0 || current >= optionCount - 1 ? 0 : current + 1
  }
  return current <= 0 || current >= optionCount ? optionCount - 1 : current - 1
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

function contactDisplayName(contact: Contact): string {
  return contact.displayName?.trim() || contact.name
}

function getAvatarFallbackForAddress(address: string): string | null {
  const domain = address.split('@')[1]
  return domain ? getDomainAvatarUrl(domain) : null
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
