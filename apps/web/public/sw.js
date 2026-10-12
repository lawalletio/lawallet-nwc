/*
 * LaWallet PWA service worker.
 *
 * Strategy:
 *  - Navigations (HTML): network-first, fall back to the last cached page for
 *    the same URL, then to a generic offline shell. Keeps the wallet openable
 *    offline with its last-known state. A network that hasn't answered within
 *    NAVIGATION_TIMEOUT_MS loses to the cached page (a flaky connection must
 *    not hang the launch); its response still refreshes the cache.
 *  - Static assets (Next `/_next/static`, icons, images): cache-first — these
 *    are content-hashed / immutable so a stale hit is always correct. Only
 *    successful responses are stored, and the cache is capped at
 *    STATIC_CACHE_MAX_ENTRIES (oldest first) so it doesn't grow per deploy.
 *  - Wallet read APIs (GET only): network-first, falling back to the cached
 *    copy only when the network is unreachable, so the wallet still renders
 *    offline without ever replaying a body a mutation has already
 *    invalidated. Never caches non-GET or auth-sensitive mutations.
 *
 * Bump CACHE_VERSION to invalidate old caches on deploy.
 */
// v4: drops any 404 static chunk a v3 worker cached mid-deploy.
const CACHE_VERSION = 'v4'
const STATIC_CACHE = `lawallet-static-${CACHE_VERSION}`
const PAGE_CACHE = `lawallet-pages-${CACHE_VERSION}`
const API_CACHE = `lawallet-api-${CACHE_VERSION}`
const OFFLINE_URL = '/wallet'
// Only caches this worker created. Others on the origin (e.g. the app's own
// `lawallet-lottie-v1`) are not ours to delete on activate.
const OWN_CACHE_PREFIXES = [
  'lawallet-static-',
  'lawallet-pages-',
  'lawallet-api-'
]
const STATIC_CACHE_MAX_ENTRIES = 300
const NAVIGATION_TIMEOUT_MS = 3500
let userDataEpoch = 0

// Wallet routes precached at install so cold, offline launches render the app
// shell for whichever tab the user opens.
const APP_SHELL = [
  '/wallet',
  '/wallet/activity',
  '/wallet/receive',
  '/wallet/send',
  '/wallet/scan',
  '/wallet/settings',
  '/animations/treasure-chest.lottie'
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
  const isStale = key =>
    !keep.has(key) && OWN_CACHE_PREFIXES.some(prefix => key.startsWith(prefix))
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(isStale).map(k => caches.delete(k)))
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
    // Drop every API cache, but keep the precached app shell: HTML here is
    // not personalized (auth lives in localStorage), and wiping it would
    // leave the next offline launch with nothing to render. Other visited
    // pages go, since their URLs can still name the previous account's data.
    event.waitUntil(
      Promise.all([
        caches
          .keys()
          .then(keys =>
            Promise.all(
              keys
                .filter(key => key.startsWith('lawallet-api-'))
                .map(key => caches.delete(key))
            )
          ),
        caches.open(PAGE_CACHE).then(async cache => {
          const shell = new Set(
            APP_SHELL.map(path => new URL(path, self.location.origin).href)
          )
          const requests = await cache.keys()
          await Promise.all(
            requests
              .filter(request => !shell.has(request.url))
              .map(request => cache.delete(request))
          )
        })
      ]).catch(() => {})
    )
  }
})

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/logos/') ||
    url.pathname.startsWith('/animations/') ||
    /\.(?:png|jpg|jpeg|svg|webp|woff2?|ico)$/.test(url.pathname)
  )
}

function isCacheableApi(url) {
  return CACHEABLE_API.some(re => re.test(url.pathname + url.search))
}

function cachedPage(request) {
  return caches
    .match(request)
    .then(cached => cached || caches.match(OFFLINE_URL))
}

// Cache-first never re-puts a hit, so key order is first-seen order: trimming
// from the front evicts the assets of the oldest deploys. An evicted chunk
// that is still in use simply gets fetched again.
async function trimStaticCache(cache) {
  const keys = await cache.keys()
  const excess = keys.length - STATIC_CACHE_MAX_ENTRIES
  if (excess > 0) {
    await Promise.all(keys.slice(0, excess).map(key => cache.delete(key)))
  }
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

  // The OAuth consent page is useless offline and its URL carries a fresh
  // `state` and PKCE challenge on every visit, so caching it would only grow
  // the page cache by one entry per authorization.
  if (url.pathname.startsWith('/oauth/')) return

  // HTML navigations — network-first with a timed cache fallback.
  if (request.mode === 'navigate') {
    let cacheWrite
    const network = fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone()
        cacheWrite = caches
          .open(PAGE_CACHE)
          .then(cache => cache.put(request, copy))
      }
      return response
    })
    // Keep the worker alive until a late network response has been cached,
    // even when the cached page already answered the navigation.
    event.waitUntil(network.then(() => cacheWrite).catch(() => {}))
    event.respondWith(
      new Promise(resolve => {
        // Slow network: answer from the cache if there is anything to show,
        // otherwise keep waiting for the network. Resolving twice is a no-op.
        const timer = setTimeout(() => {
          cachedPage(request).then(cached => {
            if (cached) resolve(cached)
          })
        }, NAVIGATION_TIMEOUT_MS)
        network.then(
          response => {
            clearTimeout(timer)
            resolve(response)
          },
          () => {
            clearTimeout(timer)
            cachedPage(request).then(cached =>
              resolve(cached || Response.error())
            )
          }
        )
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
            // A 404 for a chunk mid-deploy must not stick: caching it would
            // replay the ChunkLoadError until the next CACHE_VERSION bump.
            if (response.ok && !response.redirected) {
              const copy = response.clone()
              event.waitUntil(
                caches
                  .open(STATIC_CACHE)
                  .then(async cache => {
                    await cache.put(request, copy)
                    await trimStaticCache(cache)
                  })
                  .catch(() => {})
              )
            }
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
    // Start the network request first; the cache key (a SHA-256) is only
    // needed once a response is in hand.
    const network = fetch(request)
    const cacheRequest = apiCacheRequest(request)
    event.respondWith(
      network
        .then(response => {
          const cacheControl = response.headers.get('cache-control') ?? ''
          if (response.ok && !cacheControl.includes('no-store')) {
            const copy = response.clone()
            event.waitUntil(
              Promise.all([caches.open(API_CACHE), cacheRequest])
                .then(([cache, key]) => {
                  // A logout between the request and now owns the cache.
                  if (requestEpoch === userDataEpoch)
                    return cache.put(key, copy)
                })
                .catch(() => {})
            )
          }
          return response
        })
        .catch(async () => {
          const cache = await caches.open(API_CACHE)
          return (await cache.match(await cacheRequest)) || Response.error()
        })
    )
  }
})
