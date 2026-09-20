import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetSeenNotificationsForTests,
  claimNotification,
  clearAllSeenNotifications,
  hasSeenNotification,
  markNotificationSeen,
  notificationDedupeKey
} from '@/lib/client/cache/nwc-notification-dedupe'

const KEY = 'cafef00d12345678'
const TX = { type: 'incoming', paymentHash: 'hash-abc' }

describe('nwc-notification-dedupe', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetSeenNotificationsForTests()
  })

  it('claims a notification once and persists it', () => {
    expect(claimNotification(KEY, TX)).toBe(true)
    expect(claimNotification(KEY, TX)).toBe(false)
    expect(hasSeenNotification(KEY, TX)).toBe(true)

    const raw = window.localStorage.getItem(`lawallet-nwc-seen:${KEY}`)
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as { keys: string[]; schemaVersion: number }
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.keys).toContain(
      notificationDedupeKey(TX.type, TX.paymentHash)
    )
  })

  it('treats incoming and outgoing with the same hash as distinct', () => {
    expect(claimNotification(KEY, TX)).toBe(true)
    expect(
      claimNotification(KEY, { type: 'outgoing', paymentHash: TX.paymentHash })
    ).toBe(true)
  })

  it('does not claim empty hashes or empty wallet keys', () => {
    expect(claimNotification('', TX)).toBe(false)
    expect(claimNotification(KEY, { type: 'incoming', paymentHash: '' })).toBe(
      false
    )
  })

  it('hydrates from localStorage after a memory reset (replay / new tab)', () => {
    expect(claimNotification(KEY, TX)).toBe(true)
    __resetSeenNotificationsForTests()
    expect(hasSeenNotification(KEY, TX)).toBe(true)
    expect(claimNotification(KEY, TX)).toBe(false)
  })

  it('markNotificationSeen is idempotent', () => {
    markNotificationSeen(KEY, TX)
    markNotificationSeen(KEY, TX)
    expect(claimNotification(KEY, TX)).toBe(false)
  })

  it('clearAllSeenNotifications drops storage and memory', () => {
    claimNotification(KEY, TX)
    claimNotification('beefcafe00000001', {
      type: 'outgoing',
      paymentHash: 'other'
    })
    window.localStorage.setItem('lawallet-theme-color', '#123')

    clearAllSeenNotifications()

    expect(window.localStorage.getItem(`lawallet-nwc-seen:${KEY}`)).toBeNull()
    expect(
      window.localStorage.getItem('lawallet-nwc-seen:beefcafe00000001')
    ).toBeNull()
    expect(window.localStorage.getItem('lawallet-theme-color')).toBe('#123')
    expect(claimNotification(KEY, TX)).toBe(true)
  })

  it('caps the persisted ring buffer', () => {
    for (let i = 0; i < 210; i++) {
      claimNotification(KEY, { type: 'incoming', paymentHash: `h${i}` })
    }
    const raw = window.localStorage.getItem(`lawallet-nwc-seen:${KEY}`)
    const parsed = JSON.parse(raw!) as { keys: string[] }
    expect(parsed.keys).toHaveLength(200)
    expect(parsed.keys[0]).toBe('incoming:h10')
    expect(parsed.keys.at(-1)).toBe('incoming:h209')
    expect(
      hasSeenNotification(KEY, { type: 'incoming', paymentHash: 'h0' })
    ).toBe(false)
    expect(
      hasSeenNotification(KEY, { type: 'incoming', paymentHash: 'h209' })
    ).toBe(true)
  })

  it('ignores malformed JSON and schema mismatches', () => {
    window.localStorage.setItem(`lawallet-nwc-seen:${KEY}`, '{not json')
    expect(claimNotification(KEY, TX)).toBe(true)

    __resetSeenNotificationsForTests()
    window.localStorage.setItem(
      `lawallet-nwc-seen:${KEY}`,
      JSON.stringify({ keys: ['incoming:hash-abc'], schemaVersion: 999 })
    )
    expect(claimNotification(KEY, TX)).toBe(true)
  })
})
