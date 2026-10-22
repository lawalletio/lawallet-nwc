'use client'

import { useSyncExternalStore } from 'react'
import { useContacts } from '@/lib/client/contacts-store'
import { getDomainAvatarUrl } from '@/lib/client/lightning-address-suggestions'

const STORAGE_KEY = 'lawallet-payment-destinations'
const MAX_ENTRIES = 500

/**
 * What we knew about a Lightning Address payment when we sent it. NWC
 * `list_transactions` only returns the recipient's invoice description, so
 * the address, avatar and LUD-12 comment are kept locally by payment hash.
 */
export interface PaymentDestination {
  address: string
  name: string | null
  avatarUrl: string | null
  comment: string | null
  savedAt: number
}

type DestinationMap = Record<string, PaymentDestination>

let cache: DestinationMap | null = null
const listeners = new Set<() => void>()

function read(): DestinationMap {
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    cache = raw ? (JSON.parse(raw) as DestinationMap) : {}
  } catch {
    cache = {}
  }
  return cache
}

export function rememberPaymentDestination(
  paymentHash: string | null,
  destination: Omit<PaymentDestination, 'savedAt'>
): void {
  const hash = paymentHash?.trim()
  if (!hash || typeof window === 'undefined') return
  // LUD-06 metadata images arrive as base64 `data:` URIs; hundreds of those
  // would blow the localStorage quota, so the row falls back to the domain.
  const avatarUrl = destination.avatarUrl?.startsWith('data:')
    ? null
    : destination.avatarUrl
  const next: DestinationMap = {
    ...read(),
    [hash]: { ...destination, avatarUrl, savedAt: Date.now() }
  }
  const entries = Object.entries(next)
  cache =
    entries.length > MAX_ENTRIES
      ? Object.fromEntries(
          entries
            .sort(([, a], [, b]) => b.savedAt - a.savedAt)
            .slice(0, MAX_ENTRIES)
        )
      : next
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // quota errors — the in-memory cache still serves this session
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  function onStorage(e: StorageEvent) {
    if (e.key !== STORAGE_KEY) return
    cache = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** Null during SSR and for payments not sent to a Lightning Address here. */
export function usePaymentDestination(
  paymentHash: string | null | undefined
): PaymentDestination | null {
  return useSyncExternalStore(
    subscribe,
    () => (paymentHash ? (read()[paymentHash] ?? null) : null),
    () => null
  )
}

/**
 * Best avatar for a Lightning Address: the one saved at pay time, then the
 * saved contact's (NIP-05 hydrated) picture, then the domain's logo.
 */
export function useAddressAvatar(
  address: string | null | undefined,
  saved?: string | null
): string | null {
  const contacts = useContacts()
  if (!address) return null
  const lower = address.toLowerCase()
  const contact = contacts.find(c => c.lightningAddress.toLowerCase() === lower)
  return (
    saved ??
    contact?.avatarUrl ??
    getDomainAvatarUrl(address.split('@')[1] ?? '')
  )
}

const LUD16_COMMENT_RE = /^(Payment to @[^:\s]+): ([\s\S]+)$/

/**
 * Our LUD-16 callback mints invoices described as
 * `Payment to @user: <comment>` (see `lud16/[username]/cb/actions/pay.ts`).
 * Splits that into the `Payment to @user` label and the payer's comment;
 * any other description comes back whole with no comment.
 */
export function splitPaymentDescription(description: string): {
  label: string
  comment: string | null
} {
  const trimmed = description.trim()
  const match = trimmed.match(LUD16_COMMENT_RE)
  return match
    ? { label: match[1], comment: match[2].trim() || null }
    : { label: trimmed, comment: null }
}

/** Test-only. */
export function __resetPaymentDestinationsForTests(): void {
  cache = null
}
