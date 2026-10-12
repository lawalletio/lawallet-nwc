import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

/**
 * Boots `public/sw.js` in a fake ServiceWorkerGlobalScope and returns its
 * event handlers plus an in-memory CacheStorage double (one Map per cache).
 *
 * The service worker controls the whole origin, so its caching strategy for
 * `/api/wallet/*` decides whether an admin page can ever see a mutation.
 */
const SW_ORIGIN = 'https://wallet.test'

function cacheKey(req: Request | string) {
  return typeof req === 'string' ? new URL(req, SW_ORIGIN).href : req.url
}

type Store = Map<string, Response>

function loadServiceWorker(fetchImpl: typeof fetch, cacheNames: string[] = []) {
  const stores = new Map<string, Store>(cacheNames.map(n => [n, new Map()]))
  const store = (name: string): Store => {
    if (!stores.has(name)) stores.set(name, new Map())
    return stores.get(name)!
  }
  const openCache = (name: string) => {
    const entries = store(name)
    return {
      match: async (req: Request | string) => entries.get(cacheKey(req)),
      put: async (req: Request, res: Response) =>
        void entries.set(cacheKey(req), res),
      add: async () => {},
      keys: async () => [...entries.keys()].map(url => new Request(url)),
      delete: async (req: Request | string) => entries.delete(cacheKey(req))
    }
  }
  const caches = {
    open: async (name: string) => openCache(name),
    keys: async () => [...stores.keys()],
    match: async (req: Request | string) => {
      for (const entries of stores.values()) {
        const hit = entries.get(cacheKey(req))
        if (hit) return hit
      }
    },
    delete: async (name: string) => stores.delete(name)
  }
  const listeners = new Map<string, (event: unknown) => void>()
  const pending: Promise<unknown>[] = []
  const waitUntil = (p: Promise<unknown>) => void pending.push(p)

  const self = {
    location: { origin: SW_ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) =>
      void listeners.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} }
  }

  const context = vm.createContext({
    self,
    caches,
    fetch: fetchImpl,
    crypto: globalThis.crypto,
    // Late-bound so vi.useFakeTimers() reaches the worker's timers.
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    Request,
    Response,
    URL,
    TextEncoder,
    Uint8Array,
    Array,
    Promise,
    Set,
    Map,
    console
  })
  vm.runInContext(
    readFileSync(join(process.cwd(), 'public/sw.js'), 'utf8'),
    context
  )
  const names = vm.runInContext(
    '({ STATIC_CACHE, PAGE_CACHE, API_CACHE, STATIC_CACHE_MAX_ENTRIES })',
    context
  ) as {
    STATIC_CACHE: string
    PAGE_CACHE: string
    API_CACHE: string
    STATIC_CACHE_MAX_ENTRIES: number
  }

  const onFetch = listeners.get('fetch')!
  return {
    names,
    stores,
    pages: store(names.PAGE_CACHE),
    statics: store(names.STATIC_CACHE),
    api: store(names.API_CACHE),
    /** Resolves once every waitUntil() promise (cache writes) has settled. */
    async settled() {
      for (let i = 0; i < pending.length; i++) await pending[i]
    },
    handle(request: Request): Promise<Response> {
      const captured: Promise<Response>[] = []
      onFetch({
        request,
        waitUntil,
        respondWith: (p: Promise<Response>) => captured.push(p)
      })
      expect(captured).toHaveLength(1)
      return captured[0]
    },
    /** Whether the worker answers this request itself (calls respondWith). */
    intercepts(request: Request): boolean {
      let answered = false
      onFetch({ request, waitUntil, respondWith: () => void (answered = true) })
      return answered
    },
    activate() {
      listeners.get('activate')!({ waitUntil })
      return this.settled()
    },
    message(data: unknown) {
      listeners.get('message')!({ data, waitUntil })
      return this.settled()
    }
  }
}

const URL_ADDRESSES = `${SW_ORIGIN}/api/wallet/addresses`
const WALLET_URL = `${SW_ORIGIN}/wallet`

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html' }
  })
}

function navigateRequest(url: string) {
  const request = new Request(url)
  Object.defineProperty(request, 'mode', { value: 'navigate' })
  return request
}

describe('service worker: /api/wallet read caching', () => {
  it('serves the network response, not a stale cached one', async () => {
    let payload: string[] = ['alice', 'deleted-address']
    const sw = loadServiceWorker(async () => jsonResponse(payload))

    const first = await sw.handle(new Request(URL_ADDRESSES))
    expect(await first.json()).toEqual(['alice', 'deleted-address'])

    // The address is deleted server-side. A cache-first strategy would
    // replay the previous body here — that is the bug this guards.
    payload = ['alice']
    const second = await sw.handle(new Request(URL_ADDRESSES))
    expect(await second.json()).toEqual(['alice'])
  })

  it('falls back to the cached response when the network is unreachable', async () => {
    let online = true
    const sw = loadServiceWorker(async () => {
      if (!online) throw new Error('offline')
      return jsonResponse(['alice'])
    })

    await sw.handle(new Request(URL_ADDRESSES))
    online = false

    const offline = await sw.handle(new Request(URL_ADDRESSES))
    expect(await offline.json()).toEqual(['alice'])
  })
})

describe('service worker: navigation caching', () => {
  it('leaves the OAuth consent page to the browser', async () => {
    const sw = loadServiceWorker(async () => htmlResponse('consent'))
    const url = `${SW_ORIGIN}/oauth/authorize?client_id=abc&state=xyz`

    expect(sw.intercepts(navigateRequest(url))).toBe(false)

    await sw.settled()
    expect(sw.pages.has(url)).toBe(false)
  })

  it('caches a successful navigation and returns the network response', async () => {
    const sw = loadServiceWorker(async () => htmlResponse('wallet-shell'))

    const response = await sw.handle(navigateRequest(WALLET_URL))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('wallet-shell')

    await sw.settled()
    expect(await sw.pages.get(WALLET_URL)!.text()).toBe('wallet-shell')
  })

  it('returns a 5xx navigation without overwriting a precached 200 shell', async () => {
    const sw = loadServiceWorker(async () => htmlResponse('server-error', 500))
    sw.pages.set(WALLET_URL, htmlResponse('wallet-shell'))

    const response = await sw.handle(navigateRequest(WALLET_URL))
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('server-error')

    await sw.settled()
    expect(await sw.pages.get(WALLET_URL)!.text()).toBe('wallet-shell')
  })

  it('returns a 404 navigation without caching it', async () => {
    const sw = loadServiceWorker(async () => htmlResponse('not-found', 404))

    const response = await sw.handle(navigateRequest(`${SW_ORIGIN}/missing`))
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('not-found')

    await sw.settled()
    expect(sw.pages.has(`${SW_ORIGIN}/missing`)).toBe(false)
  })

  it('falls back to the last cached 200 page when the network is unreachable', async () => {
    let online = true
    const sw = loadServiceWorker(async () => {
      if (!online) throw new Error('offline')
      return htmlResponse('wallet-shell')
    })

    await sw.handle(navigateRequest(WALLET_URL))
    await sw.settled()
    online = false

    const offline = await sw.handle(navigateRequest(WALLET_URL))
    expect(offline.status).toBe(200)
    expect(await offline.text()).toBe('wallet-shell')
  })

  it('does not replay a transient 5xx after the user goes offline', async () => {
    let status = 200
    const sw = loadServiceWorker(async () => {
      if (status === 0) throw new Error('offline')
      return htmlResponse(
        status === 200 ? 'wallet-shell' : 'server-error',
        status
      )
    })

    await sw.handle(navigateRequest(WALLET_URL))
    await sw.settled()

    status = 500
    const error = await sw.handle(navigateRequest(WALLET_URL))
    expect(error.status).toBe(500)

    status = 0
    const offline = await sw.handle(navigateRequest(WALLET_URL))
    expect(offline.status).toBe(200)
    expect(await offline.text()).toBe('wallet-shell')
  })

  it('falls back to the cached /wallet shell for a non-shell route when offline', async () => {
    let online = true
    const sw = loadServiceWorker(async () => {
      if (!online) throw new Error('offline')
      return htmlResponse('wallet-shell')
    })

    await sw.handle(navigateRequest(WALLET_URL))
    await sw.settled()
    online = false

    const offline = await sw.handle(
      navigateRequest(`${SW_ORIGIN}/wallet/withdraw`)
    )
    expect(offline.status).toBe(200)
    expect(await offline.text()).toBe('wallet-shell')
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => (resolve = r))
  return { promise, resolve }
}

const CHUNK_URL = `${SW_ORIGIN}/_next/static/chunks/app-abc123.js`

describe('service worker: static assets', () => {
  it('caches a successful chunk', async () => {
    const sw = loadServiceWorker(async () => new Response('chunk'))

    await sw.handle(new Request(CHUNK_URL))
    await sw.settled()
    expect(await sw.statics.get(CHUNK_URL)!.text()).toBe('chunk')
  })

  it('does not cache a 404 chunk served mid-deploy', async () => {
    let status = 404
    const sw = loadServiceWorker(
      async () => new Response(status === 404 ? 'missing' : 'chunk', { status })
    )

    const miss = await sw.handle(new Request(CHUNK_URL))
    expect(miss.status).toBe(404)
    await sw.settled()
    expect(sw.statics.has(CHUNK_URL)).toBe(false)

    // Once the deploy lands, the next request reaches the network again.
    status = 200
    const hit = await sw.handle(new Request(CHUNK_URL))
    expect(await hit.text()).toBe('chunk')
  })

  it('caps the static cache by evicting the oldest entries', async () => {
    const sw = loadServiceWorker(async () => new Response('new'))
    const max = sw.names.STATIC_CACHE_MAX_ENTRIES
    for (let i = 0; i < max; i++) {
      sw.statics.set(`${SW_ORIGIN}/_next/static/old-${i}.js`, new Response())
    }

    await sw.handle(new Request(CHUNK_URL))
    await sw.settled()

    expect(sw.statics.size).toBe(max)
    expect(sw.statics.has(`${SW_ORIGIN}/_next/static/old-0.js`)).toBe(false)
    expect(sw.statics.has(CHUNK_URL)).toBe(true)
  })
})

describe('service worker: navigation timeout', () => {
  afterEach(() => void vi.useRealTimers())

  it('answers from the cache on a slow network, then refreshes the cache', async () => {
    vi.useFakeTimers()
    const network = deferred<Response>()
    const sw = loadServiceWorker(() => network.promise)
    sw.pages.set(WALLET_URL, htmlResponse('old-shell'))

    const pending = sw.handle(navigateRequest(WALLET_URL))
    await vi.advanceTimersByTimeAsync(3500)
    expect(await (await pending).text()).toBe('old-shell')

    network.resolve(htmlResponse('new-shell'))
    await sw.settled()
    expect(await sw.pages.get(WALLET_URL)!.text()).toBe('new-shell')
  })

  it('keeps waiting for a slow network when nothing is cached', async () => {
    vi.useFakeTimers()
    const network = deferred<Response>()
    const sw = loadServiceWorker(() => network.promise)

    let settled = false
    const pending = sw.handle(navigateRequest(`${SW_ORIGIN}/admin`))
    void pending.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(settled).toBe(false)

    network.resolve(htmlResponse('admin'))
    expect(await (await pending).text()).toBe('admin')
  })
})

describe('service worker: activate', () => {
  it('deletes only its own stale caches', async () => {
    const sw = loadServiceWorker(
      async () => new Response(),
      [
        'lawallet-static-v3',
        'lawallet-pages-v3',
        'lawallet-api-v3',
        'lawallet-lottie-v1',
        'unrelated-cache'
      ]
    )
    const { STATIC_CACHE, PAGE_CACHE, API_CACHE } = sw.names

    await sw.activate()

    expect([...sw.stores.keys()].sort()).toEqual(
      [
        API_CACHE,
        PAGE_CACHE,
        STATIC_CACHE,
        'lawallet-lottie-v1',
        'unrelated-cache'
      ].sort()
    )
  })
})

describe('service worker: CLEAR_USER_DATA', () => {
  it('drops API data and visited pages but keeps the app shell', async () => {
    const sw = loadServiceWorker(
      async () => new Response(),
      ['lawallet-api-v3', 'lawallet-lottie-v1']
    )
    sw.api.set(URL_ADDRESSES, jsonResponse(['alice']))
    sw.pages.set(WALLET_URL, htmlResponse('wallet-shell'))
    sw.pages.set(`${SW_ORIGIN}/wallet/send`, htmlResponse('send'))
    sw.pages.set(`${SW_ORIGIN}/admin/users/alice`, htmlResponse('alice'))
    sw.statics.set(CHUNK_URL, new Response('chunk'))

    await sw.message({ type: 'CLEAR_USER_DATA' })

    expect(sw.stores.has(sw.names.API_CACHE)).toBe(false)
    expect(sw.stores.has('lawallet-api-v3')).toBe(false)
    expect([...sw.pages.keys()].sort()).toEqual(
      [WALLET_URL, `${SW_ORIGIN}/wallet/send`].sort()
    )
    expect(sw.statics.has(CHUNK_URL)).toBe(true)
    expect(sw.stores.has('lawallet-lottie-v1')).toBe(true)
  })
})

describe('service worker: API reads', () => {
  it('starts the network request before hashing the cache key', () => {
    const fetchSpy = vi.fn(async () => jsonResponse([]))
    const sw = loadServiceWorker(fetchSpy)

    void sw.handle(new Request(URL_ADDRESSES))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not cache a response that lands after logout', async () => {
    const network = deferred<Response>()
    const sw = loadServiceWorker(() => network.promise)

    const pending = sw.handle(new Request(URL_ADDRESSES))
    await sw.message({ type: 'CLEAR_USER_DATA' })
    network.resolve(jsonResponse(['previous-account']))
    await pending
    await sw.settled()

    expect(sw.stores.get(sw.names.API_CACHE)?.size ?? 0).toBe(0)
  })
})
