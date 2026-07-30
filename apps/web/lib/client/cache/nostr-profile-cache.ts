'use client'

export const NOSTR_PROFILE_CACHE_KEY = 'lawallet-nostr-profiles'
export const NOSTR_PROFILE_CACHE_CLEARED_EVENT =
  'lawallet:nostr-profile-cache-cleared'

let cacheEpoch = 0

export function getNostrProfileCacheEpoch(): number {
  return cacheEpoch
}

/**
 * Clears the persisted profile snapshot and invalidates requests that started
 * before logout. The provider listens for the event to drop its ref cache too.
 */
export function clearNostrProfileCache(): void {
  cacheEpoch += 1
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(NOSTR_PROFILE_CACHE_KEY)
  } catch {
    // ignore unavailable storage
  }
  window.dispatchEvent(new Event(NOSTR_PROFILE_CACHE_CLEARED_EVENT))
}
