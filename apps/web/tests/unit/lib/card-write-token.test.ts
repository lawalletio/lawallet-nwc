import { describe, it, expect, vi } from 'vitest'

// The helper module imports the Prisma client at the top; stub it so the pure
// functions under test can be imported without a live DB.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { isCardFresh, isWriteTokenValid } from '@/lib/card-write-token'

describe('isCardFresh', () => {
  it('is true only when the card has never been tapped or blocked', () => {
    expect(isCardFresh({ lastUsedAt: null, blockedAt: null, ntag424: { ctr: 0 } })).toBe(true)
    expect(isCardFresh({ lastUsedAt: null, blockedAt: null, ntag424: null })).toBe(true)
  })

  it('is false once the card has been used', () => {
    expect(isCardFresh({ lastUsedAt: new Date(), blockedAt: null, ntag424: { ctr: 0 } })).toBe(false)
    expect(isCardFresh({ lastUsedAt: null, blockedAt: null, ntag424: { ctr: 1 } })).toBe(false)
  })

  it('is false once the card is blocked (reset keys exported)', () => {
    expect(isCardFresh({ lastUsedAt: null, blockedAt: new Date(), ntag424: { ctr: 0 } })).toBe(false)
  })
})

describe('isWriteTokenValid', () => {
  const base = {
    writeToken: 'abc',
    writeTokenExpiresAt: new Date(Date.now() + 60_000),
    lastUsedAt: null as Date | null,
    blockedAt: null as Date | null,
    ntag424: { ctr: 0 } as { ctr: number } | null,
  }

  it('accepts a matching, unexpired token on a fresh card', () => {
    expect(isWriteTokenValid(base, 'abc')).toBe(true)
  })

  it('rejects a missing or mismatched token', () => {
    expect(isWriteTokenValid(base, null)).toBe(false)
    expect(isWriteTokenValid(base, undefined)).toBe(false)
    expect(isWriteTokenValid(base, 'wrong')).toBe(false)
    expect(isWriteTokenValid({ ...base, writeToken: null }, 'abc')).toBe(false)
  })

  it('rejects an expired token', () => {
    expect(
      isWriteTokenValid(
        { ...base, writeTokenExpiresAt: new Date(Date.now() - 1_000) },
        'abc',
      ),
    ).toBe(false)
  })

  it('rejects once the card has been tapped, even with a matching token', () => {
    expect(isWriteTokenValid({ ...base, lastUsedAt: new Date() }, 'abc')).toBe(false)
    expect(isWriteTokenValid({ ...base, ntag424: { ctr: 5 } }, 'abc')).toBe(false)
  })

  it('rejects a blocked card, even with a matching token', () => {
    expect(isWriteTokenValid({ ...base, blockedAt: new Date() }, 'abc')).toBe(false)
  })
})
