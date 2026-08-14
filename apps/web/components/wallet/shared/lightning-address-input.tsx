'use client'

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useApi } from '@/lib/client/hooks/use-api'
import { useDebouncedValue } from '@/lib/client/hooks/use-debounced-value'
import { useLightningAddressAvatar } from '@/lib/client/hooks/use-lightning-address-avatar'
import { contactsActions, useContacts } from '@/lib/client/contacts-store'
import {
  buildLightningAddressSuggestions,
  getDomainAvatarUrl,
  resolveCurrentLightningDomain,
  type LightningAddressSuggestion
} from '@/lib/client/lightning-address-suggestions'
import { isLightningAddress } from '@/lib/ln-address'
import { cn } from '@/lib/utils'

const RECENT_PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_RECENT_OPTIONS = 10
const AVATAR_LOOKUP_DEBOUNCE_MS = 400

interface UserMeResponse {
  lightningAddress: string | null
}

export interface LightningAddressInputProps {
  value: string
  onChange: (value: string) => void
  /** Fired when an option is picked, or Enter selects the highlighted one. */
  onSelect?: (address: string) => void
  /**
   * `inline` renders the option list as a full-height panel below the field —
   * the send screen, where the list IS the screen. `popover` floats it over
   * the page, which is what every in-form field needs.
   */
  variant?: 'inline' | 'popover'
  /**
   * Surfaces that also accept bolt11 / LNURL / npub. Only affects the trailing
   * "looks complete" avatar lookup; suggestion generation already declines to
   * suggest for those prefixes.
   */
  allowNonAddress?: boolean
  /** Hide the saved-contacts group, showing only generated suggestions. */
  hideContacts?: boolean
  id?: string
  name?: string
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  className?: string
  inputRef?: React.Ref<HTMLInputElement>
  'aria-label'?: string
  onBlur?: () => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

/**
 * One Lightning-address field for the whole app: saved recipients, generated
 * `username@domain` suggestions, avatars, and full combobox keyboard support.
 *
 * Controlled — the caller owns the value. Everything specific to a surface
 * (what happens on submit, whether a bolt11 is acceptable) stays at the call
 * site; this component only helps the user arrive at a string.
 */
export function LightningAddressInput({
  value,
  onChange,
  onSelect,
  variant = 'popover',
  allowNonAddress = false,
  hideContacts = false,
  id,
  name,
  placeholder = 'satoshi@lawallet.ar',
  disabled,
  invalid,
  autoFocus,
  className,
  inputRef,
  onBlur,
  onKeyDown,
  ...rest
}: LightningAddressInputProps) {
  const contacts = useContacts()
  const { data: me } = useApi<UserMeResponse>('/api/users/me')
  const [open, setOpen] = useState(variant === 'inline')
  const [focused, setFocused] = useState(false)
  const [highlightedOptionIndex, setHighlightedOptionIndex] = useState(-1)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const localInputRef = useRef<HTMLInputElement | null>(null)
  // Unique per instance: the forwarding editor mounts several of these at once,
  // and a shared listbox id would produce duplicate DOM ids and point every
  // field's aria-controls at the same list.
  const reactId = useId()
  const listboxId = `lightning-address-options-${reactId}`

  const query = value.trim().toLowerCase()
  const currentDomain = resolveCurrentLightningDomain(me?.lightningAddress)

  const recentContacts = useMemo(
    () => (hideContacts || query ? [] : contacts.slice(0, MAX_RECENT_OPTIONS)),
    [contacts, hideContacts, query]
  )
  const suggestedAddresses = useMemo(
    () =>
      buildLightningAddressSuggestions(
        value,
        currentDomain,
        contacts.map(contact => contact.lightningAddress)
      ),
    [contacts, currentDomain, value]
  )

  // Once the typed value IS one of the options, offering the other domains is
  // noise — the user already settled on one. Collapse to that single row.
  const exactMatch =
    contacts.find(contact => contact.lightningAddress === query) ??
    suggestedAddresses.find(
      suggestion => suggestion.lightningAddress === query
    ) ??
    null

  const visibleContacts = exactMatch
    ? recentContacts.filter(contact => contact.lightningAddress === query)
    : recentContacts
  const visibleSuggestions = exactMatch
    ? suggestedAddresses.filter(
        suggestion => suggestion.lightningAddress === query
      )
    : suggestedAddresses

  const hasOptions = visibleContacts.length > 0 || visibleSuggestions.length > 0
  const listVisible = hasOptions && (variant === 'inline' || open)

  const optionValues = useMemo(
    () => [
      ...visibleContacts.map(contact => contact.lightningAddress),
      ...visibleSuggestions.map(suggestion => suggestion.lightningAddress)
    ],
    [visibleContacts, visibleSuggestions]
  )
  const activeOptionIndex =
    highlightedOptionIndex >= 0 && highlightedOptionIndex < optionValues.length
      ? highlightedOptionIndex
      : -1
  const activeOptionId =
    activeOptionIndex >= 0 ? optionId(listboxId, activeOptionIndex) : undefined

  // Only the finished address gets a real profile lookup — see the hook.
  const debouncedValue = useDebouncedValue(query, AVATAR_LOOKUP_DEBOUNCE_MS)
  const typedAvatar = useLightningAddressAvatar(
    !allowNonAddress || isLightningAddress(debouncedValue)
      ? debouncedValue
      : null
  )

  // Keep saved contacts' avatars warm, TTL-gated.
  useEffect(() => {
    if (hideContacts) return
    for (const contact of contacts.slice(0, MAX_RECENT_OPTIONS)) {
      if (
        contact.profileFetchedAt &&
        Date.now() - contact.profileFetchedAt < RECENT_PROFILE_TTL_MS
      ) {
        continue
      }
      void contactsActions.hydrateNip05Profile(contact.lightningAddress)
    }
  }, [contacts, hideContacts])

  useEffect(() => {
    if (activeOptionIndex < 0) return
    optionRefs.current[activeOptionIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeOptionIndex])

  // An exact match leaves exactly one row — highlight it, so Enter commits
  // without an extra ArrowDown.
  const exactMatchAddress = exactMatch?.lightningAddress ?? null
  useEffect(() => {
    if (exactMatchAddress) setHighlightedOptionIndex(0)
  }, [exactMatchAddress])

  function commit(nextValue: string) {
    onChange(nextValue)
    setHighlightedOptionIndex(-1)
    if (variant === 'popover') setOpen(false)
    onSelect?.(nextValue)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(e)
    if (e.defaultPrevented) return

    const optionCount = listVisible ? optionValues.length : 0

    if (e.key === 'ArrowDown' && optionCount > 0) {
      e.preventDefault()
      setOpen(true)
      setHighlightedOptionIndex(current =>
        nextOptionIndex(current, optionCount, 1)
      )
      return
    }

    if (e.key === 'ArrowUp' && optionCount > 0) {
      e.preventDefault()
      setOpen(true)
      setHighlightedOptionIndex(current =>
        nextOptionIndex(current, optionCount, -1)
      )
      return
    }

    if (e.key === 'Enter' && activeOptionIndex >= 0) {
      e.preventDefault()
      const selected = optionValues[activeOptionIndex]
      if (selected) commit(selected)
      return
    }

    if (e.key === 'Escape') {
      if (activeOptionIndex >= 0) {
        e.preventDefault()
        setHighlightedOptionIndex(-1)
        return
      }
      if (variant === 'popover' && open) {
        e.preventDefault()
        setOpen(false)
      }
    }
  }

  const optionList = listVisible ? (
    <section
      id={listboxId}
      role="listbox"
      aria-label="Lightning address options"
      className={
        variant === 'inline'
          ? 'min-h-0 flex-1 overflow-hidden'
          : 'max-h-72 overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1.5 shadow-lg'
      }
    >
      <div
        className={
          variant === 'inline'
            ? 'flex h-full flex-col gap-3 overflow-y-auto overscroll-y-contain pb-4 pr-1 [scrollbar-gutter:stable]'
            : 'flex flex-col gap-2'
        }
      >
        {visibleContacts.length > 0 && (
          <LightningAddressOptionGroup title="Saved">
            {visibleContacts.map((contact, index) => (
              <LightningAddressOptionButton
                key={contact.id}
                id={optionId(listboxId, index)}
                name={contact.lightningAddress}
                avatarUrl={
                  contact.avatarUrl ??
                  getAvatarFallbackForAddress(contact.lightningAddress)
                }
                active={activeOptionIndex === index}
                buttonRef={node => {
                  optionRefs.current[index] = node
                }}
                onHighlight={() => setHighlightedOptionIndex(index)}
                onSelect={() => commit(contact.lightningAddress)}
                disabled={disabled}
              />
            ))}
          </LightningAddressOptionGroup>
        )}

        {visibleSuggestions.length > 0 && (
          <LightningAddressOptionGroup title="Suggestions">
            {visibleSuggestions.map((suggestion, index) => {
              const optionIndex = visibleContacts.length + index
              // The exact typed address is the only one worth a real avatar.
              const resolved =
                typedAvatar.avatarUrl &&
                suggestion.lightningAddress === debouncedValue
                  ? typedAvatar.avatarUrl
                  : suggestion.avatarUrl
              return (
                <LightningAddressOptionButton
                  key={suggestion.lightningAddress}
                  id={optionId(listboxId, optionIndex)}
                  name={suggestion.lightningAddress}
                  avatarUrl={resolved}
                  active={activeOptionIndex === optionIndex}
                  buttonRef={node => {
                    optionRefs.current[optionIndex] = node
                  }}
                  onHighlight={() => setHighlightedOptionIndex(optionIndex)}
                  onSelect={() => commit(suggestion.lightningAddress)}
                  disabled={disabled}
                />
              )
            })}
          </LightningAddressOptionGroup>
        )}
      </div>
    </section>
  ) : null

  // A settled address: valid, and the user has moved on. Show who it is
  // instead of leaving a bare string, and offer a way back to editing.
  const settled = !focused && isLightningAddress(query)
  const settledAvatarUrl = settled
    ? (typedAvatar.avatarUrl ?? getAvatarFallbackForAddress(query))
    : null

  const field = (
    <Input
      ref={node => {
        localInputRef.current = node
        if (typeof inputRef === 'function') inputRef(node)
        else if (inputRef) {
          ;(
            inputRef as React.MutableRefObject<HTMLInputElement | null>
          ).current = node
        }
      }}
      id={id}
      name={name}
      role="combobox"
      value={value}
      onChange={e => {
        // One place decides casing, so every surface agrees.
        onChange(e.target.value.toLowerCase())
        setHighlightedOptionIndex(-1)
        if (variant === 'popover') setOpen(true)
      }}
      onFocus={() => {
        setFocused(true)
        if (variant === 'popover') setOpen(true)
      }}
      onBlur={() => {
        setFocused(false)
        // Let a click on an option land before the list unmounts.
        if (variant === 'popover') window.setTimeout(() => setOpen(false), 120)
        onBlur?.()
      }}
      onKeyDown={handleKeyDown}
      aria-autocomplete="list"
      aria-expanded={listVisible}
      aria-controls={listVisible ? listboxId : undefined}
      aria-activedescendant={activeOptionId}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoComplete="off"
      data-1p-ignore
      data-lpignore="true"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      disabled={disabled}
      className={cn(
        invalid && 'border-destructive',
        settled && 'pl-11 pr-20',
        className
      )}
      aria-label={rest['aria-label']}
    />
  )

  // One stable wrapper, always rendered: switching between a bare input and a
  // wrapped one remounts the input, which drops focus mid-typing and orphans
  // the ref. Only the affordances come and go.
  const fieldWithAffordances = (
    <div className="group relative">
      {settled && (
        <Avatar className="pointer-events-none absolute left-2 top-1/2 size-7 -translate-y-1/2 border border-border/70">
          {settledAvatarUrl && (
            <AvatarImage
              src={settledAvatarUrl}
              alt=""
              className="object-cover"
            />
          )}
          <AvatarFallback className="text-[10px]">
            {initialsFor(query)}
          </AvatarFallback>
        </Avatar>
      )}
      {field}
      {settled && (
        <button
          type="button"
          // Hidden until hover, but still tabbable and revealed on focus — a
          // keyboard user has no hover to trigger it with.
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
          onClick={() => {
            const node = localInputRef.current
            node?.focus()
            // Select rather than clear: replacing is the common case, and a
            // mis-click must not destroy the address.
            node?.select()
          }}
          disabled={disabled}
        >
          Change
        </button>
      )}
    </div>
  )

  if (variant === 'inline') {
    return (
      <>
        {fieldWithAffordances}
        {optionList ?? <div className="min-h-0 flex-1" />}
      </>
    )
  }

  // Portalled on purpose: several of these live inside cards and dialogs with
  // `overflow-hidden`, which clips an absolutely-positioned list.
  return (
    <PopoverPrimitive.Root open={Boolean(optionList)}>
      {/* Anchor a full-width wrapper rather than the Input itself: Radix
      derives --radix-popover-trigger-width from the anchor, and measuring a
      wrapper that spans the field keeps the list exactly as wide as it. */}
      <PopoverPrimitive.Anchor asChild>
        <div className="w-full">{fieldWithAffordances}</div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={6}
          // The field keeps the focus — this is a combobox, not a dialog.
          onOpenAutoFocus={event => event.preventDefault()}
          onCloseAutoFocus={event => event.preventDefault()}
          // Typing must keep reaching the input behind the list.
          onPointerDownOutside={event => event.preventDefault()}
          className="z-50 w-[var(--radix-popover-trigger-width)] outline-none"
        >
          {optionList}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export function LightningAddressOptionGroup({
  title,
  children
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1" role="group" aria-label={title}>
      <p className="px-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}

export function LightningAddressOptionButton({
  id,
  name,
  avatarUrl,
  active,
  buttonRef,
  onHighlight,
  onSelect,
  disabled
}: {
  id: string
  name: string
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
      // mousedown, not click: the input's blur would close the list first.
      onMouseDown={e => e.preventDefault()}
      onClick={onSelect}
      onMouseEnter={onHighlight}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-70',
        active
          ? 'border-[var(--theme-300)] bg-accent/80'
          : 'border-border/70 bg-card/80 hover:border-border hover:bg-card'
      )}
    >
      <Avatar className="size-7 border border-border/70">
        {avatarUrl && (
          <AvatarImage src={avatarUrl} alt="" className="object-cover" />
        )}
        <AvatarFallback className="text-[10px]">
          {initialsFor(name)}
        </AvatarFallback>
      </Avatar>
      {/* One line only: the address already contains the username, and the
      domain was repeating what the address ends with. */}
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {name}
      </span>
    </button>
  )
}

function optionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`
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

export function initialsFor(source: string): string {
  const parts = source
    .replace(/@.*/, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
  const first = parts[0]?.[0] ?? '?'
  const second = parts.length > 1 ? parts[1]?.[0] : parts[0]?.[1]
  return `${first}${second ?? ''}`.toUpperCase()
}

function getAvatarFallbackForAddress(address: string): string | null {
  const domain = address.split('@')[1]
  return domain ? getDomainAvatarUrl(domain) : null
}

export type { LightningAddressSuggestion }
