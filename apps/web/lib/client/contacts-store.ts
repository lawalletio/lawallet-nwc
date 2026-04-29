'use client'

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'lawallet-contacts'

export interface Contact {
  id: string
  name: string
  lightningAddress: string
  npub?: string | null
  avatarUrl?: string | null
  createdAt: number
}

let cache: Contact[] | null = null
const listeners = new Set<() => void>()

function read(): Contact[] {
  if (typeof window === 'undefined') return []
  if (cache) return cache
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    cache = raw ? (JSON.parse(raw) as Contact[]) : []
  } catch {
    cache = []
  }
  return cache
}

function write(next: Contact[]) {
  cache = next
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // ignore quota errors — in-memory cache still serves reads
    }
  }
  for (const listener of listeners) listener()
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

export function useContacts(): Contact[] {
  return useSyncExternalStore(
    subscribe,
    read,
    () => [],
  )
}

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

/** Test-only hook to reset the module-level cache between cases. */
export function __resetContactsCacheForTests() {
  cache = null
}
