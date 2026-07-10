'use client'

import { useSyncExternalStore } from 'react'
import {
  DEFAULT_NOSTR_RELAYS,
  normalizeNostrPubkey,
  parseKind0Content,
} from '@/lib/nostr/profile'

const STORAGE_KEY = 'lawallet-contacts'
const MAX_RECENT_CONTACTS = 12
const PROFILE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const LN_ADDRESS_RE = /^([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})$/i

/** Saved-recipient entry persisted in localStorage by the wallet send flow. */
export interface Contact {
  id: string
  name: string
  displayName?: string | null
  lightningAddress: string
  pubkey?: string | null
  npub?: string | null
  avatarUrl?: string | null
  /** Epoch ms; used for most-recently-used ordering in the UI. */
  createdAt: number
  /** Epoch ms for the last successful NIP-05/profile cache attempt. */
  profileFetchedAt?: number | null
}

let cache: Contact[] | null = null
const listeners = new Set<() => void>()

function read(): Contact[] {
  if (typeof window === 'undefined') return []
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as Contact[]) : []
    cache = dedupeContacts(parsed)
  } catch {
    cache = []
  }
  return cache
}

function write(next: Contact[]) {
  const normalized = dedupeContacts(next).slice(0, MAX_RECENT_CONTACTS)
  cache = normalized
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // ignore quota errors — in-memory cache still serves reads
    }
  }
  for (const listener of listeners) listener()
}

function dedupeContacts(contacts: Contact[]): Contact[] {
  const seen = new Set<string>()
  const result: Contact[] = []

  for (const contact of contacts) {
    const keys = contactIdentityKeys(contact)
    if (keys.some(key => seen.has(key))) continue
    result.push(contact)
    for (const key of keys) seen.add(key)
  }

  return result
}

function contactIdentityKeys(contact: Contact): string[] {
  const keys = [`address:${contact.lightningAddress.toLowerCase()}`]
  const pubkey = contact.pubkey?.trim().toLowerCase()
  const npub = contact.npub?.trim().toLowerCase()
  const displayName = contact.displayName?.trim().toLowerCase()
  const avatarUrl = contact.avatarUrl?.trim()

  if (pubkey) keys.unshift(`pubkey:${pubkey}`)
  if (npub) keys.unshift(`npub:${npub}`)
  if (displayName && avatarUrl) keys.unshift(`profile:${displayName}:${avatarUrl}`)

  return keys
}

function normalizeLightningAddress(address: string): string | null {
  const normalized = address.trim().toLowerCase()
  return LN_ADDRESS_RE.test(normalized) ? normalized : null
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (typeof window !== 'undefined' && listeners.size === 1) {
    window.addEventListener('storage', onStorage)
  }
  return () => {
    listeners.delete(listener)
    if (typeof window !== 'undefined' && listeners.size === 0) {
      window.removeEventListener('storage', onStorage)
    }
  }
}

function onStorage(e: StorageEvent) {
  if (e.key !== STORAGE_KEY) return
  cache = null
  for (const listener of listeners) listener()
}

function genId() {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return rand
}

function displayNameFor(address: string): string {
  return address.split('@')[0] || address
}

function needsProfileRefresh(contact: Contact): boolean {
  const hasNip05DisplayName = Boolean(
    contact.displayName?.trim() && (contact.pubkey || contact.npub),
  )
  return (
    !hasNip05DisplayName ||
    !contact.profileFetchedAt ||
    Date.now() - contact.profileFetchedAt > PROFILE_TTL_MS
  )
}

/**
 * Subscribes to the contacts list. Returns the most-recently-added entries
 * first. Empty during SSR — the data is localStorage-only on purpose.
 */
export function useContacts(): Contact[] {
  return useSyncExternalStore(
    subscribe,
    read,
    () => [],
  )
}

/** Mutation surface for the contacts store — all writes notify subscribers. */
export const contactsActions = {
  add(input: Omit<Contact, 'id' | 'createdAt'>): Contact {
    const contact: Contact = {
      id: genId(),
      createdAt: Date.now(),
      ...input,
    }
    write([contact, ...read()])
    return contact
  },
  upsertRecent(input: {
    lightningAddress: string
    name?: string | null
    displayName?: string | null
    pubkey?: string | null
    npub?: string | null
    avatarUrl?: string | null
    profileFetchedAt?: number | null
    touch?: boolean
  }): Contact | null {
    const lightningAddress = normalizeLightningAddress(input.lightningAddress)
    if (!lightningAddress) return null

    const contacts = read()
    const existing = contacts.find(c => c.lightningAddress === lightningAddress)
    const now = Date.now()
    const displayName = firstUseful(
      input.displayName,
      existing?.displayName,
    )
    const contact: Contact = {
      id: existing?.id ?? genId(),
      createdAt: input.touch === false && existing ? existing.createdAt : now,
      name:
        input.name?.trim() ||
        displayName ||
        existing?.name ||
        displayNameFor(lightningAddress),
      displayName,
      lightningAddress,
      pubkey: input.pubkey ?? existing?.pubkey ?? null,
      npub: input.npub ?? existing?.npub ?? null,
      avatarUrl: input.avatarUrl ?? existing?.avatarUrl ?? null,
      profileFetchedAt:
        input.profileFetchedAt ?? existing?.profileFetchedAt ?? null,
    }

    const next =
      input.touch === false && existing
        ? contacts.map(c =>
            c.lightningAddress === lightningAddress ? contact : c,
          )
        : [
            contact,
            ...contacts.filter(c => c.lightningAddress !== lightningAddress),
          ].slice(0, MAX_RECENT_CONTACTS)
    write(next)
    return contact
  },
  async hydrateNip05Profile(lightningAddress: string): Promise<Contact | null> {
    const normalizedAddress = normalizeLightningAddress(lightningAddress)
    if (!normalizedAddress) return null

    const current = read().find(c => c.lightningAddress === normalizedAddress)
    if (current && !needsProfileRefresh(current)) return current

    const profile = await resolveNip05Profile(normalizedAddress)
    if (!profile) return current ?? null

    const displayName = firstUseful(profile.displayName, profile.name)
    return contactsActions.upsertRecent({
      lightningAddress: normalizedAddress,
      name:
        displayName ??
        current?.name ??
        displayNameFor(normalizedAddress),
      displayName: displayName ?? current?.displayName ?? null,
      pubkey: profile.pubkey ?? current?.pubkey ?? null,
      npub: profile.npub ?? current?.npub ?? null,
      avatarUrl: profile.avatarUrl ?? current?.avatarUrl ?? null,
      profileFetchedAt: Date.now(),
      touch: false,
    })
  },
  update(id: string, patch: Partial<Omit<Contact, 'id' | 'createdAt'>>) {
    write(read().map(c => (c.id === id ? { ...c, ...patch } : c)))
  },
  remove(id: string) {
    write(read().filter(c => c.id !== id))
  },
  clear() {
    write([])
  },
}

interface Nip05Response {
  names?: Record<string, string>
  relays?: Record<string, string[]>
}

interface NostrEvent {
  pubkey: string
  content: string
  created_at: number
}

interface ResolvedNip05Profile {
  displayName: string | null
  name: string | null
  pubkey: string | null
  npub: string | null
  avatarUrl: string | null
}

async function resolveNip05Profile(
  lightningAddress: string,
): Promise<ResolvedNip05Profile | null> {
  const [name, host] = lightningAddress.split('@')
  if (!name || !host) return null

  const url = `https://${host}/.well-known/nostr.json?name=${encodeURIComponent(name)}`
  let nip05: Nip05Response

  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    if (!response.ok) return null
    nip05 = (await response.json()) as Nip05Response
  } catch {
    return null
  }

  const pubkey = findNip05Pubkey(nip05.names, name)
  const normalizedPubkey = pubkey ? normalizeNostrPubkey(pubkey) : null
  if (!normalizedPubkey) return null

  const profile = await fetchKind0Profile(
    normalizedPubkey.pubkey,
    nip05.relays?.[normalizedPubkey.pubkey],
  )
  if (!profile) return null

  return {
    displayName: profile.displayName ?? profile.name ?? null,
    name: profile.name ?? null,
    pubkey: normalizedPubkey.pubkey,
    npub: normalizedPubkey.npub,
    avatarUrl: profile.picture ?? null,
  }
}

function firstUseful(
  ...values: Array<string | null | undefined>
): string | null {
  return values.find(value => value?.trim())?.trim() ?? null
}

function findNip05Pubkey(
  names: Nip05Response['names'],
  name: string,
): string | null {
  if (!names) return null
  const direct = names[name]
  if (typeof direct === 'string') return direct
  const lower = name.toLowerCase()
  const entry = Object.entries(names).find(
    ([key]) => key.toLowerCase() === lower,
  )
  return typeof entry?.[1] === 'string' ? entry[1] : null
}

async function fetchKind0Profile(pubkey: string, nip05Relays?: string[]) {
  const relays = sanitizeRelays(nip05Relays)
  try {
    const { SimplePool } = await import('nostr-tools/pool')
    const pool = new SimplePool()
    try {
      const events = await pool.querySync(relays, {
        kinds: [0],
        authors: [pubkey],
      })
      const newest = newestEvent(events)
      return newest ? parseKind0Content(pubkey, newest.content) : null
    } finally {
      pool.close(relays)
    }
  } catch {
    return null
  }
}

function sanitizeRelays(relays?: string[]): string[] {
  const filtered =
    relays?.filter(relay => /^wss?:\/\//i.test(relay)).slice(0, 8) ?? []
  return filtered.length > 0 ? filtered : DEFAULT_NOSTR_RELAYS
}

function newestEvent(events: unknown[]): NostrEvent | null {
  let newest: NostrEvent | null = null
  for (const event of events) {
    if (!isNostrEvent(event)) continue
    if (!newest || event.created_at > newest.created_at) newest = event
  }
  return newest
}

function isNostrEvent(event: unknown): event is NostrEvent {
  if (!event || typeof event !== 'object') return false
  const candidate = event as Record<string, unknown>
  return (
    typeof candidate.pubkey === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.created_at === 'number'
  )
}

/** Test-only hook to reset the module-level cache between cases. */
export function __resetContactsCacheForTests() {
  cache = null
}
