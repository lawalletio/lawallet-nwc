/*
 * LaWallet PWA service worker.
 *
 * Strategy:
 *  - Navigations (HTML): network-first, fall back to the last cached page for
 *    the same URL, then to a generic offline shell. Keeps the wallet openable
 *    offline with its last-known state.
 *  - Static assets (Next `/_next/static`, icons, images): cache-first — these
 *    are content-hashed / immutable so a stale hit is always correct.
 *  - Wallet read APIs (GET only): network-first, falling back to the cached
 *    copy only when the network is unreachable, so the wallet still renders
 *    offline without ever replaying a body a mutation has already
 *    invalidated. Never caches non-GET or auth-sensitive mutations.
 *
 * Bump CACHE_VERSION to invalidate old caches on deploy.
 */
const CACHE_VERSION = 'v3'
const STATIC_CACHE = `lawallet-static-${CACHE_VERSION}`
const PAGE_CACHE = `lawallet-pages-${CACHE_VERSION}`
const API_CACHE = `lawallet-api-${CACHE_VERSION}`
const OFFLINE_URL = '/wallet'
const USER_DATA_CACHE_PREFIXES = ['lawallet-api-', 'lawallet-pages-']
let userDataEpoch = 0

// Wallet routes precached at install so cold, offline launches render the app
// shell for whichever tab the user opens.
const APP_SHELL = [
  '/wallet',
  '/wallet/activity',
  '/wallet/receive',
  '/wallet/send',
  '/wallet/scan',
  '/wallet/settings'
]

// Read APIs safe to serve stale-while-revalidate while offline. Profile and
// settings are included so the wallet renders identity + branding offline.
const CACHEABLE_API = [
  /^\/api\/wallet(\/|$|\?)/,
  /^\/api\/activity(\/|$|\?)/,
  /^\/api\/users\/me(\/|$|\?)/,
  /^\/api\/settings(\/|$|\?)/
]

self.addEventListener('install', event => {
  // Warm the app shell so a cold, offline launch still renders something.
  // Best-effort: a single failed fetch must not abort the whole install.
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then(cache => Promise.allSettled(APP_SHELL.map(url => cache.add(url))))
      .catch(() => {})
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  const keep = new Set([STATIC_CACHE, PAGE_CACHE, API_CACHE])
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

// Let the page trigger an immediate activation after an update.
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
  if (event.data?.type === 'CLEAR_USER_DATA') {
    // Any authenticated fetch already in flight belongs to the session that
    // just ended. Bumping the epoch prevents its eventual response from
    // recreating a cache after the deletion below.
    userDataEpoch += 1
    event.waitUntil(
      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(key =>
                USER_DATA_CACHE_PREFIXES.some(prefix => key.startsWith(prefix))
              )
              .map(key => caches.delete(key))
          )
        )
        .catch(() => {})
    )
  }
})

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/logos/') ||
    /\.(?:png|jpg|jpeg|svg|webp|woff2?|ico)$/.test(url.pathname)
  )
}

function isCacheableApi(url) {
  return CACHEABLE_API.some(re => re.test(url.pathname + url.search))
}

async function apiCacheRequest(request) {
  const authorization = request.headers.get('authorization') || 'anonymous'
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(authorization)
  )
  const fingerprint = Array.from(new Uint8Array(digest).slice(0, 16))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
  const url = new URL(request.url)
  // CacheStorage keys do not distinguish Authorization headers. Add an opaque
  // fingerprint to the internal cache key so two JWTs can never share a
  // `/api/users/me` (or wallet/activity) response.
  url.searchParams.set('__lawallet_session', fingerprint)
  return new Request(url.toString(), { method: 'GET' })
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // HTML navigations — network-first with cache fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone()
          caches.open(PAGE_CACHE).then(cache => cache.put(request, copy))
          return response
        })
        .catch(async () => {
          const cached = await caches.match(request)
          return cached || (await caches.match(OFFLINE_URL)) || Response.error()
        })
    )
    return
  }

  // Static, content-hashed assets — cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        cached =>
          cached ||
          fetch(request).then(response => {
            const copy = response.clone()
            caches.open(STATIC_CACHE).then(cache => cache.put(request, copy))
            return response
          })
      )
    )
    return
  }

  // Wallet read APIs — network-first, cache only as the offline fallback.
  //
  // This used to answer from the cache first. Because the service worker
  // scope is the whole origin, that made every mutation invisible for a
  // generation: deleting a Lightning Address and returning to
  // /admin/addresses replayed the cached `/api/wallet/addresses` body that
  // still listed it, and no amount of client-side invalidation could help —
  // the staleness lives below `fetch`. `lib/client/hooks/use-api.ts` already
  // does stale-while-revalidate in memory, with invalidation on mutation, so
  // the copy here only needs to cover being offline.
  if (isCacheableApi(url)) {
    const requestEpoch = userDataEpoch
    event.respondWith(
      caches.open(API_CACHE).then(async cache => {
        const cacheRequest = await apiCacheRequest(request)
        const cached = await cache.match(cacheRequest)
        const network = fetch(request)
          .then(response => {
            const cacheControl = response.headers.get('cache-control') ?? ''
            if (
              response.ok &&
              requestEpoch === userDataEpoch &&
              !cacheControl.includes('no-store')
            ) {
              cache.put(cacheRequest, response.clone()).catch(() => {})
            }
            return response
          })
          .catch(() => cached || Response.error())
        return network
      })
    )
  }
})
