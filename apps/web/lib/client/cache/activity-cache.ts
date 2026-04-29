/**
 * Per-NWC transaction history cache, backed by IndexedDB.
 *
 * Activity pages and the home preview hydrate from here on mount so the
 * list paints before `listTransactions` returns. Cap is 500 most-recent
 * rows per wallet — well under any browser's IDB quota and enough that
 * the user almost never has to wait on the network for older history.
 */

import {
  STORE_NWC_TX,
  INDEX_BY_NWC_AND_TIME,
  idbBulkPut,
  idbDeleteByIndexRange,
  idbReadIndexDesc,
  openDb,
} from './idb'
import type { NwcTransaction } from '@/lib/client/nwc'

interface CachedTx extends NwcTransaction {
  /** Hashed NWC URI — see `lib/client/cache/key.ts`. */
  nwcKey: string
  /** Primary key inside `nwc-tx`. */
  compositeKey: string
  /** When this row was last touched locally. Used as a tiebreaker. */
  indexedAt: number
}

const DEFAULT_KEEP = 500

function compositeKey(nwcKey: string, paymentHash: string): string {
  return `${nwcKey}:${paymentHash}`
}

function toCachedTx(nwcKey: string, tx: NwcTransaction): CachedTx {
  return {
    ...tx,
    nwcKey,
    compositeKey: compositeKey(nwcKey, tx.paymentHash),
    indexedAt: Date.now(),
  }
}

function stripCacheFields(row: CachedTx): NwcTransaction {
  // `CachedTx` is a superset of `NwcTransaction`; strip the cache-only
  // fields so callers see exactly the same shape `listTransactions`
  // returns from the network.
  const {
    nwcKey: _nwcKey,
    compositeKey: _compositeKey,
    indexedAt: _indexedAt,
    ...tx
  } = row
  return tx
}

/**
 * Reads up to `limit` transactions for a wallet, newest-first by
 * `createdAt`. Returns `[]` for an unknown key, an empty wallet, or any
 * IDB failure — the caller should still issue the live fetch in parallel.
 */
export async function readRecent(
  nwcKey: string,
  limit = 25,
): Promise<NwcTransaction[]> {
  if (!nwcKey) return []
  try {
    const range = IDBKeyRange.bound(
      [nwcKey, -Infinity],
      [nwcKey, Infinity],
    )
    const rows = await idbReadIndexDesc<CachedTx>(
      STORE_NWC_TX,
      INDEX_BY_NWC_AND_TIME,
      range,
      limit,
    )
    return rows.map(stripCacheFields)
  } catch {
    return []
  }
}

/**
 * Inserts or updates a batch of transactions in a single readwrite
 * transaction. Dedupes via the `compositeKey` primary key, so receiving
 * the same payment_hash twice (from a notification + a list response)
 * is idempotent.
 *
 * After insert, prunes the wallet down to `keepCount` newest rows so the
 * cache doesn't grow unbounded for high-volume wallets.
 */
export async function upsertMany(
  nwcKey: string,
  txs: NwcTransaction[],
  keepCount = DEFAULT_KEEP,
): Promise<void> {
  if (!nwcKey || txs.length === 0) return
  try {
    const rows = txs.map(tx => toCachedTx(nwcKey, tx))
    await idbBulkPut<CachedTx>(STORE_NWC_TX, rows)
    await prune(nwcKey, keepCount)
  } catch {
    // Cache is best-effort; never let a write failure surface to UI.
  }
}

/**
 * Drops every row past the most-recent `keepCount` for a wallet. Used by
 * `upsertMany`; exported for tests.
 */
export async function prune(
  nwcKey: string,
  keepCount = DEFAULT_KEEP,
): Promise<void> {
  if (!nwcKey || keepCount <= 0) return
  try {
    const range = IDBKeyRange.bound(
      [nwcKey, -Infinity],
      [nwcKey, Infinity],
    )
    const rows = await idbReadIndexDesc<CachedTx>(
      STORE_NWC_TX,
      INDEX_BY_NWC_AND_TIME,
      range,
      Number.MAX_SAFE_INTEGER,
    )
    if (rows.length <= keepCount) return
    const overflow = rows.slice(keepCount)
    if (overflow.length === 0) return
    // Delete by primary key one shot so we keep the operation in a single
    // transaction. We run the deletes through a manual IDBKeyRange union
    // would be ideal, but per-row delete inside one txn is simpler and
    // bounded by the page-size we control.
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NWC_TX, 'readwrite')
      const store = tx.objectStore(STORE_NWC_TX)
      for (const row of overflow) {
        store.delete(row.compositeKey)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Prune failed'))
      tx.onabort = () => reject(tx.error ?? new Error('Prune aborted'))
    })
  } catch {
    // ignore
  }
}

/** Removes every cached transaction for a wallet. Wired into logout. */
export async function clearForKey(nwcKey: string): Promise<void> {
  if (!nwcKey) return
  try {
    const range = IDBKeyRange.bound(
      [nwcKey, -Infinity],
      [nwcKey, Infinity],
    )
    await idbDeleteByIndexRange(STORE_NWC_TX, INDEX_BY_NWC_AND_TIME, range)
  } catch {
    // ignore
  }
}

/**
 * Wipes the entire `nwc-tx` object store across every wallet. Wired into
 * `logout()` so the next user on a shared device doesn't see prior
 * activity, regardless of which NWC URI they're about to sign in with.
 */
export async function clearAll(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NWC_TX, 'readwrite')
      tx.objectStore(STORE_NWC_TX).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('clearAll failed'))
      tx.onabort = () => reject(tx.error ?? new Error('clearAll aborted'))
    })
  } catch {
    // ignore
  }
}
