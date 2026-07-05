import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { AuthorizationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } })),
}))

const noopLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: noopLogger,
  createLogger: vi.fn(() => noopLogger),
  withRequestLogging: (fn: unknown) => fn,
}))

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))

vi.mock('@/lib/settings-auth', () => ({
  authenticateSettingsWriteRequest: vi.fn(),
}))

const listenerState = vi.hoisted(() => ({
  secret: null as string | null,
}))

vi.mock('@/lib/listener-config', () => ({
  getListenerConfig: async () => ({
    enabled: !!listenerState.secret,
    url: null,
    secret: listenerState.secret,
    requestTimeoutMs: 10000,
    urlSource: 'none',
    secretSource: listenerState.secret ? 'env' : 'none',
    enabledSource: 'none',
  }),
}))

import { POST } from '@/app/api/settings/listener-probe/route'
import { authenticateSettingsWriteRequest } from '@/lib/settings-auth'

const SECRET = 'probe-shared-secret-0123456789abcdef!!!!'

const validStatus = {
  startedAt: new Date().toISOString(),
  uptimeSeconds: 300,
  relays: [{ url: 'wss://relay.test', connected: true, walletCount: 3 }],
  connections: [],
  counters: {
    eventsReceived: 1,
    eventsDuplicate: 0,
    webhooksDelivered: 1,
    webhooksFailed: 0,
    nwcRequests: 0,
    nwcRequestErrors: 0,
  },
  recentEvents: [],
}

const probeRequest = (body: unknown) =>
  createNextRequest('/api/settings/listener-probe', { method: 'POST', body })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateSettingsWriteRequest).mockReset()
  vi.mocked(authenticateSettingsWriteRequest).mockResolvedValue('a'.repeat(64))
  listenerState.secret = null
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('POST /api/settings/listener-probe', () => {
  it('requires settings write permission', async () => {
    vi.mocked(authenticateSettingsWriteRequest).mockRejectedValue(
      new AuthorizationError('nope')
    )
    const res = await POST(
      probeRequest({ url: 'http://listener.test:4100', secret: SECRET })
    )
    expect(res.status).toBe(403)
  })

  it('rejects a malformed URL', async () => {
    const res = await POST(probeRequest({ url: 'not a url', secret: SECRET }))
    expect(res.status).toBe(400)
  })

  it('reports ok with uptime/connections/relays on a valid status', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(validStatus))
    vi.stubGlobal('fetch', fetchMock)

    const body = (await assertResponse(
      await POST(probeRequest({ url: 'http://listener.test:4100', secret: SECRET })),
      200
    )) as { ok: boolean; uptimeSeconds: number; relays: number }

    expect(body).toEqual({ ok: true, uptimeSeconds: 300, connections: 0, relays: 1 })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://listener.test:4100/status')
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${SECRET}`
    )
  })

  it('reports unauthorized distinctly when the listener answers 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    )
    const body = (await assertResponse(
      await POST(probeRequest({ url: 'http://listener.test:4100', secret: SECRET })),
      200
    )) as { ok: boolean; code: string }
    expect(body.ok).toBe(false)
    expect(body.code).toBe('unauthorized')
  })

  it('reports unreachable on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const body = (await assertResponse(
      await POST(probeRequest({ url: 'http://listener.test:4100', secret: SECRET })),
      200
    )) as { ok: boolean; code: string }
    expect(body.code).toBe('unreachable')
  })

  it('reports invalid_response when the URL answers with a non-status payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ hello: 'world' }))
    )
    const body = (await assertResponse(
      await POST(probeRequest({ url: 'http://listener.test:4100', secret: SECRET })),
      200
    )) as { ok: boolean; code: string }
    expect(body.code).toBe('invalid_response')
  })

  it('falls back to the resolved stored/env secret when none is posted', async () => {
    listenerState.secret = SECRET
    const fetchMock = vi.fn().mockResolvedValue(Response.json(validStatus))
    vi.stubGlobal('fetch', fetchMock)

    await assertResponse(
      await POST(probeRequest({ url: 'http://listener.test:4100' })),
      200
    )
    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${SECRET}`
    )
  })

  it('reports no_secret when neither a posted nor a resolved secret exists', async () => {
    const body = (await assertResponse(
      await POST(probeRequest({ url: 'http://listener.test:4100' })),
      200
    )) as { ok: boolean; code: string }
    expect(body.code).toBe('no_secret')
  })
})
