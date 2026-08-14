/**
 * Per-address profile snapshot cache, backed by `localStorage`.
 *
 * The contacts store already caches avatars, but only for the ≤12 addresses a
 * user has actually paid. This covers the other case: an address typed into a
 * suggesting input, which is not a contact yet and may never become one. Without
 * it, every keystroke that completes a valid address would re-run a NIP-05
 * lookup plus a relay query.
 *
 * Misses are cached too (`avatarUrl: null`). Most typed addresses do not exist,
 * and re-asking on every render of a form is the expensive case, not the hit.
 */

const STORAGE_PREFIX = 'lawallet-avatar:'
const SCHEMA_VERSION = 1 as const

/** Matches the contacts store, so both age out of a profile change together. */
export const AVATAR_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface CachedAvatar {
  /** null when the address resolved to no profile — a cached miss. */
  avatarUrl: string | null
  name: string | null
  fetchedAt: number
  schemaVersion: typeof SCHEMA_VERSION
}

function storageKey(address: string): string {
  return `${STORAGE_PREFIX}${address.trim().toLowerCase()}`
}

/** Fresh entry, or null when absent, stale, or written by an older schema. */
export function readAvatar(address: string): CachedAvatar | null {
  if (!address) return null
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(address))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedAvatar
    if (parsed?.schemaVersion !== SCHEMA_VERSION) return null
    if (typeof parsed.fetchedAt !== 'number') return null
    if (parsed.avatarUrl !== null && typeof parsed.avatarUrl !== 'string') {
      return null
    }
    if (Date.now() - parsed.fetchedAt > AVATAR_CACHE_TTL_MS) return null
    return parsed
  } catch {
    return null
  }
}

export function writeAvatar(
  address: string,
  value: { avatarUrl: string | null; name?: string | null }
): void {
  if (!address) return
  if (typeof window === 'undefined') return
  try {
    const entry: CachedAvatar = {
      avatarUrl: value.avatarUrl,
      name: value.name ?? null,
      fetchedAt: Date.now(),
      schemaVersion: SCHEMA_VERSION
    }
    window.localStorage.setItem(storageKey(address), JSON.stringify(entry))
  } catch {
    // ignore quota errors — the lookup simply runs again next time
  }
}

export function clearAvatar(address: string): void {
  if (!address) return
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storageKey(address))
  } catch {
    // ignore
  }
}

/**
 * Drops every cached avatar. Part of session cleanup: the cache is a record of
 * which addresses this user looked up, so it must not outlive the session.
 */
export function clearAllAvatars(): void {
  if (typeof window === 'undefined') return
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key)
    }
    for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
