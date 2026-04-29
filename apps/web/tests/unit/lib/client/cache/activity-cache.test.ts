import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  readRecent,
  upsertMany,
  prune,
  clearForKey,
} from '@/lib/client/cache/activity-cache'
import { __resetIdbForTests } from '@/lib/client/cache/idb'
import type { NwcTransaction } from '@/lib/client/nwc'

function tx(opts: Partial<NwcTransaction> & { paymentHash: string; createdAt: number }): NwcTransaction {
  return {
    type: 'incoming',
    amountSats: 1000,
    feesPaidSats: 0,
    description: '',
    preimage: null,
    settledAt: null,
    ...opts,
  }
}

const KEY_A = 'aaaaaaaaaaaaaaaa'
const KEY_B = 'bbbbbbbbbbbbbbbb'

describe('activity-cache', () => {
  beforeEach(() => {
    // Reset both the cached DB handle and the underlying fake-indexeddb
    // so each test starts from a clean store.
    globalThis.indexedDB = new IDBFactory()
    __resetIdbForTests()
  })

  it('returns [] for an unknown key', async () => {
    expect(await readRecent(KEY_A)).toEqual([])
  })

  it('upserts and reads back newest-first', async () => {
    await upsertMany(KEY_A, [
      tx({ paymentHash: 'h1', createdAt: 100 }),
      tx({ paymentHash: 'h2', createdAt: 200 }),
      tx({ paymentHash: 'h3', createdAt: 150 }),
    ])
    const recent = await readRecent(KEY_A, 10)
    expect(recent.map(t => t.paymentHash)).toEqual(['h2', 'h3', 'h1'])
  })

  it('dedupes by paymentHash', async () => {
    await upsertMany(KEY_A, [tx({ paymentHash: 'h1', createdAt: 100 })])
    await upsertMany(KEY_A, [
      tx({ paymentHash: 'h1', createdAt: 100, amountSats: 999 }),
    ])
    const recent = await readRecent(KEY_A)
    expect(recent).toHaveLength(1)
    expect(recent[0].amountSats).toBe(999)
  })

  it('respects readRecent limit', async () => {
    await upsertMany(
      KEY_A,
      Array.from({ length: 30 }, (_, i) =>
        tx({ paymentHash: `h${i}`, createdAt: 1000 + i }),
      ),
    )
    const five = await readRecent(KEY_A, 5)
    expect(five).toHaveLength(5)
    expect(five[0].paymentHash).toBe('h29')
    expect(five[4].paymentHash).toBe('h25')
  })

  it('prunes oldest beyond keepCount', async () => {
    await upsertMany(
      KEY_A,
      Array.from({ length: 10 }, (_, i) =>
        tx({ paymentHash: `h${i}`, createdAt: i }),
      ),
    )
    await prune(KEY_A, 4)
    const recent = await readRecent(KEY_A, 100)
    expect(recent.map(t => t.paymentHash)).toEqual(['h9', 'h8', 'h7', 'h6'])
  })

  it('isolates wallets — clearForKey only wipes the matching key', async () => {
    await upsertMany(KEY_A, [tx({ paymentHash: 'a1', createdAt: 1 })])
    await upsertMany(KEY_B, [tx({ paymentHash: 'b1', createdAt: 1 })])
    await clearForKey(KEY_A)
    expect(await readRecent(KEY_A)).toEqual([])
    const remaining = await readRecent(KEY_B)
    expect(remaining.map(t => t.paymentHash)).toEqual(['b1'])
  })

  it('serialises concurrent upserts without throwing', async () => {
    await Promise.all([
      upsertMany(KEY_A, [tx({ paymentHash: 'p1', createdAt: 1 })]),
      upsertMany(KEY_A, [tx({ paymentHash: 'p2', createdAt: 2 })]),
      upsertMany(KEY_A, [tx({ paymentHash: 'p3', createdAt: 3 })]),
    ])
    const recent = await readRecent(KEY_A)
    expect(recent.map(t => t.paymentHash).sort()).toEqual(['p1', 'p2', 'p3'])
  })
})
