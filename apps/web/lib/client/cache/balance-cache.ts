/**
 * Per-NWC balance snapshot cache, backed by `localStorage`.
 *
 * The cache exists so a reload paints the last-seen balance before the
 * NWC `getBalance` round-trip resolves — `useNwcBalance` seeds its initial
 * state from here and overwrites with the live value once it arrives.
 *
 * Synchronous read on purpose: the hook needs the value during its first
 * render to avoid a flash of `null`. Writes are also sync; we don't need
 * concurrency control because each balance update runs on the same tab.
 */

const STORAGE_PREFIX = 'lawallet-balance:'
const SCHEMA_VERSION = 1 as const

export interface CachedBalance {
  sats: number
  fetchedAt: number
  schemaVersion: typeof SCHEMA_VERSION
}

function storageKey(nwcKey: string): string {
  return `${STORAGE_PREFIX}${nwcKey}`
}

export function readBalance(nwcKey: string): CachedBalance | null {
  if (!nwcKey) return null
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(nwcKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedBalance>
    if (parsed.schemaVersion !== SCHEMA_VERSION) return null
    if (
      typeof parsed.sats !== 'number' ||
      !Number.isFinite(parsed.sats) ||
      typeof parsed.fetchedAt !== 'number'
    ) {
      return null
    }
    return {
      sats: parsed.sats,
      fetchedAt: parsed.fetchedAt,
      schemaVersion: SCHEMA_VERSION,
    }
  } catch {
    return null
  }
}

export function writeBalance(nwcKey: string, sats: number): void {
  if (!nwcKey) return
  if (typeof window === 'undefined') return
  if (!Number.isFinite(sats)) return
  const payload: CachedBalance = {
    sats,
    fetchedAt: Date.now(),
    schemaVersion: SCHEMA_VERSION,
  }
  try {
    window.localStorage.setItem(storageKey(nwcKey), JSON.stringify(payload))
  } catch {
    // Quota exhausted or storage disabled — degrade silently. The hook
    // still has the in-memory value for the active session.
  }
}

export function clearBalance(nwcKey: string): void {
  if (!nwcKey) return
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storageKey(nwcKey))
  } catch {
    // ignore
  }
}

/**
 * Removes every `lawallet-balance:*` key. Wired into `logout()` so a
 * shared device doesn't leak balances between accounts.
 */
export function clearAllBalances(): void {
  if (typeof window === 'undefined') return
  try {
    const toDelete: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key && key.startsWith(STORAGE_PREFIX)) toDelete.push(key)
    }
    for (const key of toDelete) window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
