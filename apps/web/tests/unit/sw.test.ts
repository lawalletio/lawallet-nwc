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
function loadServiceWorker(fetchImpl: typeof fetch) {
  const entries = new Map<string, Response>()
  const cache = {
    match: async (req: Request) => entries.get(req.url),
    put: async (req: Request, res: Response) => void entries.set(req.url, res),
    add: async () => {}
  }
  const listeners = new Map<string, (event: unknown) => void>()

  const self = {
    location: { origin: 'https://wallet.test' },
    addEventListener: (type: string, fn: (event: unknown) => void) =>
      void listeners.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    caches: {
      open: async () => cache,
      keys: async () => [],
      match: async () => undefined,
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

const URL_ADDRESSES = 'https://wallet.test/api/wallet/addresses'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
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
