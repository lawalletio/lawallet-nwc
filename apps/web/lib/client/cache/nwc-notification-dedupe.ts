/**
 * Last-seen NWC payment notifications, keyed per wallet.
 *
 * Wallet home uses this so a replayed `payment_received` / `payment_sent`
 * (reconnect, multi-tab, relay replay) never re-animates the balance or
 * re-fires the in-UI notice. Data updates (balance fetch, activity cache)
 * stay independent — this store only gates motion.
 *
 * In-memory Set is the same-tick source of truth; localStorage is the
 * cross-reload / multi-tab record. Failures (quota, private mode) stay
 * silent and still dedupe for the rest of the tab session.
 */

const STORAGE_PREFIX = 'lawallet-nwc-seen:'
const SCHEMA_VERSION = 1 as const
const MAX_KEYS = 200

export interface SeenNotifications {
  keys: string[]
  schemaVersion: typeof SCHEMA_VERSION
}

const memory = new Map<string, Set<string>>()

function storageKey(nwcKey: string): string {
  return `${STORAGE_PREFIX}${nwcKey}`
}

export function notificationDedupeKey(
  type: string,
  paymentHash: string
): string {
  return `${type}:${paymentHash}`
}

function readFromStorage(nwcKey: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey(nwcKey))
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<SeenNotifications>
    if (parsed.schemaVersion !== SCHEMA_VERSION) return []
    if (!Array.isArray(parsed.keys)) return []
    return parsed.keys.filter(
      (key): key is string => typeof key === 'string' && key.length > 0
    )
  } catch {
    return []
  }
}

function persist(nwcKey: string, seen: Set<string>): void {
  const keys = Array.from(seen)
  const overflow = keys.length - MAX_KEYS
  if (overflow > 0) keys.splice(0, overflow)
  if (overflow > 0) {
    seen.clear()
    for (const key of keys) seen.add(key)
  }
  if (typeof window === 'undefined') return
  const payload: SeenNotifications = {
    keys,
    schemaVersion: SCHEMA_VERSION
  }
  try {
    window.localStorage.setItem(storageKey(nwcKey), JSON.stringify(payload))
  } catch {
    // Quota / disabled storage — in-memory still covers this session.
  }
}

function getSeen(nwcKey: string): Set<string> {
  let seen = memory.get(nwcKey)
  if (seen) return seen
  seen = new Set(readFromStorage(nwcKey))
  memory.set(nwcKey, seen)
  return seen
}

/**
 * Returns `true` the first time this wallet sees `{type, paymentHash}`.
 * Subsequent calls (replays, other tabs that already wrote storage) return
 * `false`. Empty hashes cannot be deduped and are treated as unseen-but-
 * unclaimable so we never animate an unidentified event.
 */
export function claimNotification(
  nwcKey: string,
  tx: { type: string; paymentHash: string }
): boolean {
  if (!nwcKey || !tx.paymentHash) return false
  const key = notificationDedupeKey(tx.type, tx.paymentHash)
  const seen = getSeen(nwcKey)
  if (seen.has(key)) return false
  // Another tab may have persisted the key since this tab's Set was
  // hydrated — re-read so two mounts in different tabs don't double-cue.
  const stored = readFromStorage(nwcKey)
  if (stored.includes(key)) {
    for (const item of stored) seen.add(item)
    return false
  }
  seen.add(key)
  persist(nwcKey, seen)
  return true
}

/** Mark a notification seen without caring whether it was new. */
export function markNotificationSeen(
  nwcKey: string,
  tx: { type: string; paymentHash: string }
): void {
  claimNotification(nwcKey, tx)
}

export function hasSeenNotification(
  nwcKey: string,
  tx: { type: string; paymentHash: string }
): boolean {
  if (!nwcKey || !tx.paymentHash) return false
  const key = notificationDedupeKey(tx.type, tx.paymentHash)
  const seen = getSeen(nwcKey)
  if (seen.has(key)) return true
  return readFromStorage(nwcKey).includes(key)
}

/**
 * Drops every `lawallet-nwc-seen:*` key and the in-memory index. Wired into
 * logout so a shared device doesn't replay the previous account's cues.
 */
export function clearAllSeenNotifications(): void {
  memory.clear()
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

/** Test-only: wipe memory so each spec starts from an empty seen-set. */
export function __resetSeenNotificationsForTests(): void {
  memory.clear()
}
