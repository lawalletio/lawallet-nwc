import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AVATAR_CACHE_TTL_MS,
  clearAllAvatars,
  clearAvatar,
  readAvatar,
  writeAvatar
} from '@/lib/client/cache/avatar-cache'

describe('avatar cache', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.useRealTimers()
  })

  it('round-trips a resolved avatar', () => {
    writeAvatar('satoshi@lawallet.io', {
      avatarUrl: 'https://example.com/a.png',
      name: 'Satoshi'
    })

    expect(readAvatar('satoshi@lawallet.io')).toMatchObject({
      avatarUrl: 'https://example.com/a.png',
      name: 'Satoshi'
    })
  })

  it('is case- and whitespace-insensitive on the address', () => {
    writeAvatar('  Satoshi@LaWallet.io ', { avatarUrl: 'x' })

    expect(readAvatar('satoshi@lawallet.io')?.avatarUrl).toBe('x')
  })

  it('caches a miss so a nonexistent address is not re-fetched', () => {
    writeAvatar('nobody@nowhere.com', { avatarUrl: null })

    const cached = readAvatar('nobody@nowhere.com')
    // Present, but explicitly "no avatar" — distinct from a cache miss.
    expect(cached).not.toBeNull()
    expect(cached?.avatarUrl).toBeNull()
  })

  it('expires after the TTL', () => {
    writeAvatar('satoshi@lawallet.io', { avatarUrl: 'x' })
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + AVATAR_CACHE_TTL_MS + 1000)

    expect(readAvatar('satoshi@lawallet.io')).toBeNull()
  })

  it('ignores entries written by an older schema', () => {
    window.localStorage.setItem(
      'lawallet-avatar:satoshi@lawallet.io',
      JSON.stringify({ avatarUrl: 'x', fetchedAt: Date.now(), schemaVersion: 0 })
    )

    expect(readAvatar('satoshi@lawallet.io')).toBeNull()
  })

  it('survives corrupt JSON', () => {
    window.localStorage.setItem('lawallet-avatar:broken@x.com', 'not json')

    expect(readAvatar('broken@x.com')).toBeNull()
  })

  it('clears one address without touching the others', () => {
    writeAvatar('a@x.com', { avatarUrl: '1' })
    writeAvatar('b@x.com', { avatarUrl: '2' })

    clearAvatar('a@x.com')

    expect(readAvatar('a@x.com')).toBeNull()
    expect(readAvatar('b@x.com')?.avatarUrl).toBe('2')
  })

  it('clearAll drops every avatar and leaves unrelated keys alone', () => {
    writeAvatar('a@x.com', { avatarUrl: '1' })
    writeAvatar('b@x.com', { avatarUrl: '2' })
    window.localStorage.setItem('lawallet-contacts', '[]')

    clearAllAvatars()

    expect(readAvatar('a@x.com')).toBeNull()
    expect(readAvatar('b@x.com')).toBeNull()
    expect(window.localStorage.getItem('lawallet-contacts')).toBe('[]')
  })
})
