import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AlbyCreateSubAccountResponse } from '@/lib/albyhub'

// Define the logger mock inside `vi.hoisted` so it is available to the
// `vi.mock` factories (vi.mock is hoisted above all other code).
const { loggerMock, childLoggerMock } = vi.hoisted(() => {
  const child = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn()
  }
  const root = { ...child, child: vi.fn(() => child) }
  return { loggerMock: root, childLoggerMock: child }
})

// Logger reads config at module load — stub both before importing the SUT.
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ isProduction: false, logPretty: false }))
}))

// albyhub.ts calls `logger.child(...)` at construction time, so the factory
// must return a logger whose `child` returns an object with the log methods.
vi.mock('@/lib/logger', () => ({
  logger: loggerMock,
  createLogger: vi.fn(() => childLoggerMock),
  logError: vi.fn()
}))

import { AlbyHub } from '@/lib/albyhub'

const SENTINEL = 'TEST_BEARER_TOKEN_DO_NOT_LOG_4f3a9c1e'
const HUB_URL = 'https://hub.example.test'

const SUB_ACCOUNT_RESP: AlbyCreateSubAccountResponse = {
  pairingUri: 'nostr+walletconnect://',
  pairingSecretKey: 'sk',
  pairingPublicKey: 'pk',
  relayUrl: 'wss://relay.example',
  walletPubkey: 'w'.repeat(64),
  lud16: 'user@hub.example.test',
  id: 42,
  name: 'LaWallet-u1',
  returnTo: ''
}

/** Replaces `global.fetch` with a mock that resolves to a JSON `Response`. */
function mockFetch(
  body: unknown,
  init: { status?: number; statusText?: string } = {}
) {
  const status = init.status ?? 200
  return vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        statusText: init.statusText ?? ''
      })
  )
}

/** Recursively collect every string that appears anywhere in the value. */
function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
  } else if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (const v of value) collectStrings(v, out)
    } else {
      for (const v of Object.values(value as Record<string, unknown>)) {
        collectStrings(v, out)
      }
    }
  }
  return out
}

/** Returns every string passed across all recorded calls of a mock fn. */
function callArgStrings(spy: { mock: { calls: unknown[][] } }): string[] {
  const out: string[] = []
  for (const call of spy.mock.calls) {
    for (const arg of call) collectStrings(arg, out)
  }
  return out
}

const originalFetch = global.fetch
let consoleInfoSpy: ReturnType<typeof vi.spyOn>
let consoleErrorSpy: ReturnType<typeof vi.spyOn>
let consoleWarnSpy: ReturnType<typeof vi.spyOn>
let consoleLogSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  // Silence + spy console to assert it is never called with the secret.
  consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('AlbyHub — bearer token secrecy', () => {
  it('never writes the bearer token to console.* across all operations', async () => {
    mockFetch(SUB_ACCOUNT_RESP)
    mockFetch({ ok: true })

    const hub = new AlbyHub(HUB_URL, SENTINEL)
    await hub.createSubAccount('LaWallet-u1')
    await hub.createLightningAddress('u1', '42')

    const consoleCalls = [
      ...consoleInfoSpy.mock.calls,
      ...consoleErrorSpy.mock.calls,
      ...consoleWarnSpy.mock.calls,
      ...consoleLogSpy.mock.calls
    ].flatMap((call: unknown[]) => call.flatMap(arg => collectStrings(arg)))

    expect(consoleCalls.some(s => s.includes(SENTINEL))).toBe(false)
  })

  it('never passes the bearer token to the logger (info/error/warn/debug) across all operations', async () => {
    mockFetch(SUB_ACCOUNT_RESP)
    mockFetch({ ok: true })

    const hub = new AlbyHub(HUB_URL, SENTINEL)
    await hub.createSubAccount('LaWallet-u1')
    await hub.createLightningAddress('u1', '42')

    const spies = [
      childLoggerMock.info,
      childLoggerMock.error,
      childLoggerMock.warn,
      childLoggerMock.debug,
      loggerMock.child
    ] as { mock: { calls: unknown[][] } }[]

    for (const spy of spies) {
      const strings = callArgStrings(spy)
      expect(
        strings.some(s => s.includes(SENTINEL)),
        'bearer token leaked to a logger call'
      ).toBe(false)
    }
  })

  it('does not leak the token on the error log path of a failing createSubAccount', async () => {
    mockFetch({ error: 'nope' }, { status: 400, statusText: 'Bad Request' })

    const hub = new AlbyHub(HUB_URL, SENTINEL)
    await expect(hub.createSubAccount('LaWallet-u1')).rejects.toThrow(
      'Failed to create sub account'
    )

    const strings = callArgStrings(childLoggerMock.info).concat(
      callArgStrings(childLoggerMock.error)
    )
    for (const s of strings) {
      expect(s).not.toContain(SENTINEL)
    }
  })

  it('does not leak the token on the error log path of a failing createLightningAddress', async () => {
    mockFetch({ error: 'dup' }, { status: 409, statusText: 'Conflict' })

    const hub = new AlbyHub(HUB_URL, SENTINEL)
    await expect(hub.createLightningAddress('u1', '42')).rejects.toThrow(
      'Failed to create a lightning address'
    )

    const strings = callArgStrings(childLoggerMock.info).concat(
      callArgStrings(childLoggerMock.error)
    )
    for (const s of strings) {
      expect(s).not.toContain(SENTINEL)
    }
  })

  it('sends the bearer token only in the Authorization header, never in logs', async () => {
    const fetchSpy = mockFetch(SUB_ACCOUNT_RESP)

    const hub = new AlbyHub(HUB_URL, SENTINEL)
    const data = await hub.createSubAccount('LaWallet-u1')

    // The token travels on the wire (necessary)…
    expect(fetchSpy).toHaveBeenCalledWith(
      `${HUB_URL}/apps`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${SENTINEL}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        })
      })
    )
    expect(data).toEqual(SUB_ACCOUNT_RESP)
    // …but never reaches any emitted log line.
    const logStrings = callArgStrings(childLoggerMock.info).concat(
      callArgStrings(childLoggerMock.error)
    )
    expect(logStrings.some(s => s.includes(SENTINEL))).toBe(false)
  })
})

describe('AlbyHub constructor', () => {
  it('logs the URL at construction but never the token', () => {
    new AlbyHub(HUB_URL, SENTINEL)

    expect(loggerMock.child).toHaveBeenCalledWith({ module: 'albyhub' })
    const strings = callArgStrings(childLoggerMock.info)
    expect(strings.some(s => s.includes(HUB_URL))).toBe(true)
    expect(strings.some(s => s.includes(SENTINEL))).toBe(false)
  })
})
