/**
 * Tiny native IndexedDB wrapper. Promise-based, single transaction per
 * call. We avoid `idb` / `idb-keyval` so the wallet bundle stays as small
 * as possible — IDB's API is verbose but the surface we need is tiny.
 *
 * Schema (version 1):
 *   - `nwc-tx`: object store keyed by `compositeKey` (`${nwcKey}:${paymentHash}`),
 *     with index `byNwcAndTime` on `[nwcKey, createdAt]` so we can pull a
 *     wallet's transactions in time-descending order.
 */

const DB_NAME = 'lawallet'
const DB_VERSION = 1

export const STORE_NWC_TX = 'nwc-tx'
export const INDEX_BY_NWC_AND_TIME = 'byNwcAndTime'

let dbPromise: Promise<IDBDatabase> | null = null

function isAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

export function openDb(): Promise<IDBDatabase> {
  if (!isAvailable()) {
    return Promise.reject(new Error('IndexedDB is not available in this environment'))
  }
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NWC_TX)) {
        const store = db.createObjectStore(STORE_NWC_TX, {
          keyPath: 'compositeKey',
        })
        store.createIndex(INDEX_BY_NWC_AND_TIME, ['nwcKey', 'createdAt'], {
          unique: false,
        })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
    req.onblocked = () =>
      reject(new Error('IndexedDB open blocked by another tab — close other LaWallet tabs'))
  })

  return dbPromise
}

/** Cursor over an index, walking newest-first up to `limit` results. */
export async function idbReadIndexDesc<T>(
  store: string,
  index: string,
  range: IDBKeyRange,
  limit: number,
): Promise<T[]> {
  const db = await openDb()
  return new Promise<T[]>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const idx = tx.objectStore(store).index(index)
    const out: T[] = []
    const req = idx.openCursor(range, 'prev')
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor || out.length >= limit) {
        resolve(out)
        return
      }
      out.push(cursor.value as T)
      cursor.continue()
    }
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'))
  })
}

export async function idbBulkPut<T>(store: string, values: T[]): Promise<void> {
  if (values.length === 0) return
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const objStore = tx.objectStore(store)
    for (const value of values) {
      objStore.put(value)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export async function idbDeleteByIndexRange(
  store: string,
  index: string,
  range: IDBKeyRange,
): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    const idx = tx.objectStore(store).index(index)
    const req = idx.openCursor(range)
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) return
      cursor.delete()
      cursor.continue()
    }
    req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

/** Test-only: drop the memoised handle so a fresh test gets a clean DB. */
export function __resetIdbForTests() {
  dbPromise = null
}
