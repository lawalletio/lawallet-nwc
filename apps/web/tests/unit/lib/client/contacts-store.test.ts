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
