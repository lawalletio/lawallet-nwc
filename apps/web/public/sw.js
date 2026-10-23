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
 *  - APIs: not intercepted. The page owns API caching (`useApi` persists
 *    wallet reads to localStorage and revalidates on every mount), so a
 *    request that fails offline reaches it as a failure and the wallet can
 *    show its offline badge over the last-known data. A worker-side copy
 *    answered those failures with a stale 200 instead.
 *
 * Bump CACHE_VERSION to invalidate old caches on deploy.
 */
// v4: drops any 404 static chunk a v3 worker cached mid-deploy.
const CACHE_VERSION = 'v4'
const STATIC_CACHE = `lawallet-static-${CACHE_VERSION}`
const PAGE_CACHE = `lawallet-pages-${CACHE_VERSION}`
const OFFLINE_URL = '/wallet'
// Only caches this worker created. Others on the origin (e.g. the app's own
// `lawallet-lottie-v1`) are not ours to delete on activate. `lawallet-api-`
// is listed so activate drops the API cache earlier workers kept.
const OWN_CACHE_PREFIXES = [
  'lawallet-static-',
  'lawallet-pages-',
  'lawallet-api-'
]
const STATIC_CACHE_MAX_ENTRIES = 300
const NAVIGATION_TIMEOUT_MS = 3500

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
  const keep = new Set([STATIC_CACHE, PAGE_CACHE])
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
    // Keep the precached app shell: HTML here is not personalized (auth
    // lives in localStorage), and wiping it would leave the next offline
    // launch with nothing to render. Other visited pages go, since their
    // URLs can still name the previous account's data.
    event.waitUntil(
      caches
        .open(PAGE_CACHE)
        .then(async cache => {
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
        .catch(() => {})
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
  }
})
