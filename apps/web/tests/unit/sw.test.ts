import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

/**
 * Boots `public/sw.js` in a fake ServiceWorkerGlobalScope and returns the
 * registered `fetch` handler plus the in-memory CacheStorage double.
 *
 * The service worker controls the whole origin, so its caching strategy for
 * `/api/wallet/*` decides whether an admin page can ever see a mutation.
 */
const SW_ORIGIN = 'https://wallet.test'

function cacheKey(req: Request | string) {
  return typeof req === 'string' ? new URL(req, SW_ORIGIN).href : req.url
}

function loadServiceWorker(fetchImpl: typeof fetch) {
  const entries = new Map<string, Response>()
  const cache = {
    match: async (req: Request | string) => entries.get(cacheKey(req)),
    put: async (req: Request, res: Response) =>
      void entries.set(cacheKey(req), res),
    add: async () => {}
  }
  const listeners = new Map<string, (event: unknown) => void>()

  const self = {
    location: { origin: SW_ORIGIN },
    addEventListener: (type: string, fn: (event: unknown) => void) =>
      void listeners.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    caches: {
      open: async () => cache,
      keys: async () => [],
      match: async (req: Request | string) => entries.get(cacheKey(req)),
      delete: async () => true
    },
    crypto: globalThis.crypto,
    fetch: fetchImpl
  }

  const context = vm.createContext({
    self,
    caches: self.caches,
    fetch: fetchImpl,
    crypto: globalThis.crypto,
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

  const onFetch = listeners.get('fetch')!
  return {
    entries,
    async handle(request: Request): Promise<Response> {
      const captured: Promise<Response>[] = []
      onFetch({
        request,
        respondWith: (p: Promise<Response>) => captured.push(p)
      })
      expect(captured).toHaveLength(1)
      return captured[0]
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

async function waitForCacheWrite() {
  await Promise.resolve()
  await Promise.resolve()
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
  it('caches a successful navigation and returns the network response', async () => {
    const sw = loadServiceWorker(async () => htmlResponse('wallet-shell'))

    const response = await sw.handle(navigateRequest(WALLET_URL))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('wallet-shell')

    await waitForCacheWrite()
    expect(await sw.entries.get(WALLET_URL)!.text()).toBe('wallet-shell')
  })

  it('returns a 5xx navigation without overwriting a precached 200 shell', async () => {
    const sw = loadServiceWorker(async () => htmlResponse('server-error', 500))
    sw.entries.set(WALLET_URL, htmlResponse('wallet-shell'))

    const response = await sw.handle(navigateRequest(WALLET_URL))
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('server-error')

    await waitForCacheWrite()
    expect(await sw.entries.get(WALLET_URL)!.text()).toBe('wallet-shell')
  })

  it('returns a 404 navigation without caching it', async () => {
    const sw = loadServiceWorker(async () => htmlResponse('not-found', 404))

    const response = await sw.handle(navigateRequest(`${SW_ORIGIN}/missing`))
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('not-found')

    await waitForCacheWrite()
    expect(sw.entries.has(`${SW_ORIGIN}/missing`)).toBe(false)
  })

  it('falls back to the last cached 200 page when the network is unreachable', async () => {
    let online = true
    const sw = loadServiceWorker(async () => {
      if (!online) throw new Error('offline')
      return htmlResponse('wallet-shell')
    })

    await sw.handle(navigateRequest(WALLET_URL))
    await waitForCacheWrite()
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
    await waitForCacheWrite()

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
    await waitForCacheWrite()
    online = false

    const offline = await sw.handle(
      navigateRequest(`${SW_ORIGIN}/wallet/withdraw`)
    )
    expect(offline.status).toBe(200)
    expect(await offline.text()).toBe('wallet-shell')
  })
})
