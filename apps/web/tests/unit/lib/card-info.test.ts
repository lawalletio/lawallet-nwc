import { describe, it, expect } from 'vitest'
import { buildCardInfo } from '@/lib/card-info'

describe('buildCardInfo', () => {
  it('projects a paired card with a primary lightning address', () => {
    const info = buildCardInfo({
      id: 'c1',
      title: 'My Card',
      kind: 'SIMPLE',
      userId: 'u1',
      lastUsedAt: new Date('2026-01-02T03:04:05.000Z'),
      blockedAt: null,
      design: { description: 'Design', imageUrl: 'https://x/i.png' },
      user: { pubkey: 'pk', lightningAddresses: [{ username: 'alice' }] }
    })
    expect(info).toEqual({
      id: 'c1',
      title: 'My Card',
      kind: 'SIMPLE',
      paired: true,
      used: true,
      blocked: false,
      design: { description: 'Design', imageUrl: 'https://x/i.png' },
      user: { pubkey: 'pk', username: 'alice' },
      lastUsedAt: '2026-01-02T03:04:05.000Z'
    })
  })

  it('reports unpaired/unused with a null owner', () => {
    const info = buildCardInfo({
      id: 'c2',
      title: null,
      kind: 'SIMPLE',
      userId: null,
      lastUsedAt: null,
      blockedAt: null,
      design: null,
      user: null
    })
    expect(info.paired).toBe(false)
    expect(info.used).toBe(false)
    expect(info.blocked).toBe(false)
    expect(info.user).toBeNull()
    expect(info.lastUsedAt).toBeNull()
  })

  it('falls back to a null username when the owner has no primary address', () => {
    const info = buildCardInfo({
      id: 'c3',
      title: 'X',
      kind: 'SIMPLE',
      userId: 'u1',
      lastUsedAt: null,
      blockedAt: null,
      design: null,
      user: { pubkey: 'pk', lightningAddresses: [] }
    })
    expect(info.paired).toBe(true)
    expect(info.user).toEqual({ pubkey: 'pk', username: null })
  })

  it('reports blocked once reset keys have been exported', () => {
    const info = buildCardInfo({
      id: 'c4',
      title: null,
      kind: 'SIMPLE',
      userId: null,
      lastUsedAt: null,
      blockedAt: new Date('2026-01-02T03:04:05.000Z'),
      design: null,
      user: null
    })
    expect(info.blocked).toBe(true)
  })
})
