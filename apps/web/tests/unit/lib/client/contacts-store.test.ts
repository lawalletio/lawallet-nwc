import { describe, it, expect, beforeEach } from 'vitest'
import {
  contactsActions,
  __resetContactsCacheForTests,
} from '@/lib/client/contacts-store'

describe('contacts-store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetContactsCacheForTests()
  })

  it('adds a contact and persists it to localStorage', () => {
    const contact = contactsActions.add({
      name: 'Satoshi',
      lightningAddress: 'satoshi@example.com',
    })

    expect(contact.id).toBeTruthy()
    expect(contact.createdAt).toBeGreaterThan(0)

    const stored = JSON.parse(
      window.localStorage.getItem('lawallet-contacts') ?? '[]',
    )
    expect(stored).toHaveLength(1)
    expect(stored[0].lightningAddress).toBe('satoshi@example.com')
  })

  it('upserts recent Lightning addresses without duplicates', () => {
    contactsActions.upsertRecent({
      name: 'Satoshi',
      lightningAddress: 'satoshi@example.com',
    })
    contactsActions.upsertRecent({
      name: 'Alice',
      lightningAddress: 'alice@example.com',
    })
    contactsActions.upsertRecent({
      name: 'Satoshi Nakamoto',
      lightningAddress: 'SATOSHI@example.com',
      avatarUrl: 'https://example.com/avatar.png',
    })

    const stored = JSON.parse(
      window.localStorage.getItem('lawallet-contacts') ?? '[]',
    )
    expect(stored).toHaveLength(2)
    expect(stored[0]).toMatchObject({
      name: 'Satoshi Nakamoto',
      lightningAddress: 'satoshi@example.com',
      avatarUrl: 'https://example.com/avatar.png',
    })
    expect(stored[1].lightningAddress).toBe('alice@example.com')
  })

  it('preserves recent order when a profile refresh does not touch usage', () => {
    contactsActions.upsertRecent({
      name: 'Satoshi',
      lightningAddress: 'satoshi@example.com',
    })
    contactsActions.upsertRecent({
      name: 'Alice',
      lightningAddress: 'alice@example.com',
    })
    contactsActions.upsertRecent({
      name: 'Satoshi',
      lightningAddress: 'satoshi@example.com',
      avatarUrl: 'https://example.com/avatar.png',
      touch: false,
    })

    const stored = JSON.parse(
      window.localStorage.getItem('lawallet-contacts') ?? '[]',
    )
    expect(
      stored.map(
        (contact: { lightningAddress: string }) => contact.lightningAddress,
      ),
    ).toEqual(['alice@example.com', 'satoshi@example.com'])
    expect(stored[1].avatarUrl).toBe('https://example.com/avatar.png')
  })

  it('keeps a cached NIP-05 display name and avatar across fallback updates', () => {
    contactsActions.upsertRecent({
      name: 'agustin',
      displayName: 'Agustin Kassis',
      lightningAddress: 'agustin@lacrypta.ar',
      pubkey: '2ad91f1dca2dcd5fc89e7208d1e5059f0bac0870d63fc3bac21c7a9388fa18fd',
      avatarUrl: 'https://example.com/agustin.png',
    })
    contactsActions.upsertRecent({
      name: 'agustin',
      lightningAddress: 'agustin@lacrypta.ar',
      touch: false,
    })

    const stored = JSON.parse(
      window.localStorage.getItem('lawallet-contacts') ?? '[]',
    )
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      displayName: 'Agustin Kassis',
      avatarUrl: 'https://example.com/agustin.png',
      lightningAddress: 'agustin@lacrypta.ar',
    })
  })

  it('deduplicates contacts that resolve to the same Nostr identity', () => {
    const pubkey =
      '2ad91f1dca2dcd5fc89e7208d1e5059f0bac0870d63fc3bac21c7a9388fa18fd'

    contactsActions.upsertRecent({
      name: 'El Gorila',
      displayName: 'El Gorila',
      lightningAddress: 'agustin@lawallet.io',
      pubkey,
      avatarUrl: 'https://example.com/agustin.png',
    })
    contactsActions.upsertRecent({
      name: 'El Gorila',
      displayName: 'El Gorila',
      lightningAddress: 'agustin@lacrypta.ar',
      pubkey,
      avatarUrl: 'https://example.com/agustin.png',
    })

    const stored = JSON.parse(
      window.localStorage.getItem('lawallet-contacts') ?? '[]',
    )
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      displayName: 'El Gorila',
      lightningAddress: 'agustin@lacrypta.ar',
      pubkey,
    })
  })

  it('updates an existing contact', () => {
    const contact = contactsActions.add({
      name: 'Satoshi',
      lightningAddress: 'satoshi@example.com',
    })
    contactsActions.update(contact.id, { name: 'Nakamoto' })

    const stored = JSON.parse(
      window.localStorage.getItem('lawallet-contacts') ?? '[]',
    )
    expect(stored[0].name).toBe('Nakamoto')
  })

  it('removes a contact', () => {
    const a = contactsActions.add({
      name: 'A',
      lightningAddress: 'a@example.com',
    })
    contactsActions.add({ name: 'B', lightningAddress: 'b@example.com' })
    contactsActions.remove(a.id)

    const stored = JSON.parse(
      window.localStorage.getItem('lawallet-contacts') ?? '[]',
    )
    expect(stored).toHaveLength(1)
    expect(stored[0].name).toBe('B')
  })

  it('clears every contact', () => {
    contactsActions.add({ name: 'A', lightningAddress: 'a@example.com' })
    contactsActions.add({ name: 'B', lightningAddress: 'b@example.com' })
    contactsActions.clear()
    expect(
      JSON.parse(window.localStorage.getItem('lawallet-contacts') ?? '[]'),
    ).toHaveLength(0)
  })
})
