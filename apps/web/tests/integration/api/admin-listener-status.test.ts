import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { AuthenticationError } from '@/types/server/errors'

const configState = vi.hoisted(() => ({
  url: 'http://listener.test:4100' as string | undefined,
  secret: 'listener-shared-secret-0123456789abcdef!' as string | undefined,
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    listener: {
      url: configState.url,
      secret: configState.secret,
      requestTimeoutMs: 10000,
      enabled: !!(configState.url && configState.secret),
      webhookEnabled: !!configState.secret,
    },
  })),
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

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn(),
}))

import { GET } from '@/app/api/admin/listener/status/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'

const validStatus = {
  startedAt: new Date().toISOString(),
  uptimeSeconds: 120,
  relays: [{ url: 'wss://relay.test', connected: true, walletCount: 2 }],
  connections: [
    {
      walletId: 'wallet-1',
      walletName: 'Alice wallet',
      userId: 'user-1',
      state: 'subscribed',
      connected: true,
      relayUrls: ['wss://relay.test'],
      lastEventAt: new Date().toISOString(),
      lastErrorAt: null,
      lastError: null,
    },
  ],
  counters: {
    eventsReceived: 5,
    eventsDuplicate: 1,
    webhooksDelivered: 4,
    webhooksFailed: 0,
    nwcRequests: 2,
    nwcRequestErrors: 0,
  },
  recentEvents: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  // mockRejectedValue from the auth-failure test would leak into later tests
  // (clearAllMocks clears calls, not implementations) — reset + re-default.
  vi.mocked(authenticateWithPermission).mockReset()
  vi.mocked(authenticateWithPermission).mockResolvedValue(undefined as never)
  configState.url = 'http://listener.test:4100'
  configState.secret = 'listener-shared-secret-0123456789abcdef!'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/admin/listener/status', () => {
  it('propagates auth failures', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(
      new AuthenticationError('nope')
    )
    const res = await GET(createNextRequest('/api/admin/listener/status'))
    expect(res.status).toBe(401)
  })

  it('returns the disabled state when LISTENER_* env is not set', async () => {
    configState.url = undefined
    configState.secret = undefined
    const res = await GET(createNextRequest('/api/admin/listener/status'))
    const body = (await assertResponse(res, 200)) as { state: string }
    expect(body).toEqual({ state: 'disabled' })
  })

  it('returns unreachable when the listener fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const res = await GET(createNextRequest('/api/admin/listener/status'))
    const body = (await assertResponse(res, 200)) as { state: string; error: string }
    expect(body.state).toBe('unreachable')
    expect(body.error).toContain('ECONNREFUSED')
  })

  it('returns unreachable on a non-2xx listener response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    )
    const res = await GET(createNextRequest('/api/admin/listener/status'))
    const body = (await assertResponse(res, 200)) as { state: string; error: string }
    expect(body.state).toBe('unreachable')
    expect(body.error).toContain('401')
  })

  it('returns unreachable on a malformed status payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ not: 'a status' }))
    )
    const res = await GET(createNextRequest('/api/admin/listener/status'))
    const body = (await assertResponse(res, 200)) as { state: string }
    expect(body.state).toBe('unreachable')
  })

  it('proxies a valid status with the bearer secret attached', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(validStatus))
    vi.stubGlobal('fetch', fetchMock)

    const res = await GET(createNextRequest('/api/admin/listener/status'))
    const body = (await assertResponse(res, 200)) as {
      state: string
      status: typeof validStatus
    }

    expect(body.state).toBe('ok')
    expect(body.status.connections[0].walletId).toBe('wallet-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('http://listener.test:4100/status')
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer listener-shared-secret-0123456789abcdef!'
    )
  })
})
