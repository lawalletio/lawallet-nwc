/**
 * Whether the app can reach its own API right now. `api-client` reports
 * every request: a network-level failure flips it to unreachable, any HTTP
 * answer (even an error status) flips it back. The browser's `offline`
 * event flips it at once; its `online` event only makes `useApi` refetch,
 * and that answer decides — so lie-fi never reads as online.
 *
 * Drives the wallet's "offline mode" badge. Cached data keeps rendering
 * either way.
 */

let reachable = typeof navigator === 'undefined' || navigator.onLine
const listeners = new Set<() => void>()

export function reportApiReachable(next: boolean): void {
  if (reachable === next) return
  reachable = next
  for (const listener of listeners) listener()
}

export function isApiReachable(): boolean {
  return reachable
}

export function subscribeApiReachability(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => reportApiReachable(false))
}
