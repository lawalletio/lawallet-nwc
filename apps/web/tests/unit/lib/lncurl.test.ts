import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Logger reads config at module load — stub both before importing the SUT.
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn,
}))

import { createLncurlWallet, DEFAULT_LNCURL_SERVER } from '@/lib/lncurl'

const VALID_NWC = `nostr+walletconnect://${'b'.repeat(64)}?relay=wss%3A%2F%2Fr.example&secret=${'c'.repeat(64)}`

const originalFetch = global.fetch

/** Build a `fetch`-compatible mock that resolves to a text-bodied Response. */
function mockFetch(body: string, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200
  const ok = init.ok ?? (status >= 200 && status < 300)
  const fn = vi.fn(async () => ({
    ok,
    status,
    text: async () => body,
  })) as unknown as typeof fetch
  global.fetch = fn
  return fn
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  global.fetch = originalFetch
})

describe('createLncurlWallet', () => {
  it('parses a bare-text NWC URI response and returns mode SEND_RECEIVE', async () => {
    mockFetch(VALID_NWC)

    const res = await createLncurlWallet()

    expect(res).toEqual({ connectionString: VALID_NWC, mode: 'SEND_RECEIVE' })
  })

  it('parses a JSON body where a string field holds the URI', async () => {
    mockFetch(JSON.stringify({ nwc: VALID_NWC }))

    const res = await createLncurlWallet()

    expect(res.connectionString).toBe(VALID_NWC)
    expect(res.mode).toBe('SEND_RECEIVE')
  })

  it('finds the URI in a nested JSON field (depth-first scan)', async () => {
    mockFetch(JSON.stringify({ data: { wallet: { pairingUri: VALID_NWC } } }))

    const res = await createLncurlWallet()

    expect(res.connectionString).toBe(VALID_NWC)
  })

  it('extracts a URI embedded in free-text prose', async () => {
    mockFetch(`Your wallet is ready: ${VALID_NWC} — keep it secret!`)

    const res = await createLncurlWallet()

    expect(res.connectionString).toBe(VALID_NWC)
  })

  it('POSTs to the origin with the trailing slash stripped', async () => {
    const fetchMock = mockFetch(VALID_NWC)

    await createLncurlWallet()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://lncurl.lol',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('strips the trailing slash from a custom server URL', async () => {
    const fetchMock = mockFetch(VALID_NWC)

    await createLncurlWallet('https://my.lncurl.example/')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://my.lncurl.example',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('defaults to the documented LNCurl server', async () => {
    const fetchMock = mockFetch(VALID_NWC)

    await createLncurlWallet()

    expect(DEFAULT_LNCURL_SERVER).toBe('https://lncurl.lol/')
    expect(fetchMock).toHaveBeenCalledWith('https://lncurl.lol', expect.anything())
  })

  it('throws on a non-2xx response', async () => {
    mockFetch('upstream is down', { status: 502 })

    await expect(createLncurlWallet()).rejects.toThrow(/502/)
  })

  it('throws when the body contains no NWC URI', async () => {
    mockFetch(JSON.stringify({ error: 'rate limited', retryAfter: 60 }))

    await expect(createLncurlWallet()).rejects.toThrow(/walletconnect/i)
  })

  it('throws when fetch itself rejects (server unreachable)', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch

    await expect(createLncurlWallet()).rejects.toThrow(/unreachable/i)
  })
})
