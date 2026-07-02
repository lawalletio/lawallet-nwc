/*
 * LaWallet PWA service worker.
 *
 * Strategy:
 *  - Navigations (HTML): network-first, fall back to the last cached page for
 *    the same URL, then to a generic offline shell. Keeps the wallet openable
 *    offline with its last-known state.
 *  - Static assets (Next `/_next/static`, icons, images): cache-first — these
 *    are content-hashed / immutable so a stale hit is always correct.
 *  - Wallet read APIs (GET only): stale-while-revalidate so the balance and
 *    activity render instantly from cache and refresh in the background. Never
 *    caches non-GET or auth-sensitive mutations.
 *
 * Bump CACHE_VERSION to invalidate old caches on deploy.
 */
const CACHE_VERSION = 'v2'
const STATIC_CACHE = `lawallet-static-${CACHE_VERSION}`
const PAGE_CACHE = `lawallet-pages-${CACHE_VERSION}`
const API_CACHE = `lawallet-api-${CACHE_VERSION}`
const OFFLINE_URL = '/wallet'

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
      .then(keys => Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Let the page trigger an immediate activation after an update.
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
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

  // Wallet read APIs — stale-while-revalidate.
  if (isCacheableApi(url)) {
    event.respondWith(
      caches.open(API_CACHE).then(async cache => {
        const cached = await cache.match(request)
        const network = fetch(request)
          .then(response => {
            if (response.ok) cache.put(request, response.clone())
            return response
          })
          .catch(() => cached || Response.error())
        return cached || network
      })
    )
  }
})
