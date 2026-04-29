import { describe, it, expect, beforeEach } from 'vitest'
import {
  readBalance,
  writeBalance,
  clearBalance,
} from '@/lib/client/cache/balance-cache'

const KEY = 'cafef00d12345678'

describe('balance-cache', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips a balance', () => {
    expect(readBalance(KEY)).toBeNull()
    writeBalance(KEY, 1234)
    const cached = readBalance(KEY)
    expect(cached?.sats).toBe(1234)
    expect(cached?.schemaVersion).toBe(1)
    expect(cached?.fetchedAt).toBeGreaterThan(0)
  })

  it('returns null for malformed JSON', () => {
    window.localStorage.setItem(`lawallet-balance:${KEY}`, '{not json')
    expect(readBalance(KEY)).toBeNull()
  })

  it('returns null on schema-version mismatch', () => {
    window.localStorage.setItem(
      `lawallet-balance:${KEY}`,
      JSON.stringify({ sats: 1, fetchedAt: 0, schemaVersion: 999 }),
    )
    expect(readBalance(KEY)).toBeNull()
  })

  it('returns null when sats is non-finite', () => {
    window.localStorage.setItem(
      `lawallet-balance:${KEY}`,
      JSON.stringify({ sats: 'abc', fetchedAt: 0, schemaVersion: 1 }),
    )
    expect(readBalance(KEY)).toBeNull()
  })

  it('clears a single key without touching others', () => {
    writeBalance(KEY, 100)
    writeBalance('beefcafe00000001', 200)
    clearBalance(KEY)
    expect(readBalance(KEY)).toBeNull()
    expect(readBalance('beefcafe00000001')?.sats).toBe(200)
  })

  it('ignores empty key on read/write/clear', () => {
    writeBalance('', 5)
    expect(readBalance('')).toBeNull()
    expect(() => clearBalance('')).not.toThrow()
  })
})
