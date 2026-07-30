'use client'

import { clearApiCache } from '@/lib/client/hooks/use-api'
import { clearAllBalances } from '@/lib/client/cache/balance-cache'
import { clearAll as clearAllActivity } from '@/lib/client/cache/activity-cache'
import { clearNwcCacheKeyMemo } from '@/lib/client/cache/key'
import { clearContactsCache } from '@/lib/client/contacts-store'
import { clearCurrencyPreferences } from '@/lib/client/currencies-store'
import { clearNostrProfileCache } from '@/lib/client/cache/nostr-profile-cache'

const USER_CACHE_STORAGE_PREFIXES = ['lawallet-api-', 'lawallet-pages-']
const USER_SESSION_STORAGE_PREFIXES = [
  'lawallet:pending-invoice',
  'lawallet:first-load-done',
  'lawallet-loading-recovery-at',
  'lawallet-domain-wizard-'
]
const CLEAR_USER_DATA_MESSAGE = 'CLEAR_USER_DATA'

let cleanupPromise: Promise<void> = Promise.resolve()

function removeSessionStorageData(): void {
  if (typeof window === 'undefined') return
  try {
    const keys: string[] = []
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i)
      if (
        key &&
        USER_SESSION_STORAGE_PREFIXES.some(prefix => key.startsWith(prefix))
      ) {
        keys.push(key)
      }
    }
    for (const key of keys) window.sessionStorage.removeItem(key)
  } catch {
    // Storage can be disabled in private browsing.
  }
}

async function clearBrowserCacheStorage(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return
  try {
    const names = await window.caches.keys()
    await Promise.all(
      names
        .filter(name =>
          USER_CACHE_STORAGE_PREFIXES.some(prefix => name.startsWith(prefix))
        )
        .map(name => window.caches.delete(name))
    )
  } catch {
    // CacheStorage is best-effort; auth cleanup must still complete.
  }
}

function notifyServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  const message = { type: CLEAR_USER_DATA_MESSAGE }
  navigator.serviceWorker.controller?.postMessage(message)
  void navigator.serviceWorker
    .getRegistration()
    .then(registration => {
      const active = registration?.active
      if (active && active !== navigator.serviceWorker.controller) {
        active.postMessage(message)
      }
    })
    .catch(() => {})
}

/**
 * Clears every account-scoped browser cache. Synchronous stores are wiped
 * before this returns; asynchronous IndexedDB/CacheStorage cleanup continues
 * through the returned promise.
 */
export function clearSessionCaches(): Promise<void> {
  clearApiCache()
  clearAllBalances()
  clearNwcCacheKeyMemo()
  clearContactsCache()
  clearCurrencyPreferences()
  clearNostrProfileCache()
  removeSessionStorageData()
  notifyServiceWorker()

  cleanupPromise = Promise.all([
    cleanupPromise.catch(() => {}),
    clearAllActivity(),
    clearBrowserCacheStorage()
  ]).then(() => {})

  return cleanupPromise
}

/**
 * Login and identity-swap flows await this barrier so they cannot hydrate
 * while a preceding logout is still deleting IndexedDB/CacheStorage data.
 */
export function waitForSessionCacheCleanup(): Promise<void> {
  return cleanupPromise
}
