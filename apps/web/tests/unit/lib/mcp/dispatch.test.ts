// @vitest-environment node
// Node's Request keeps `host` like the real server does; happy-dom drops it as
// a browser-forbidden header.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
  return {
    logger,
    createLogger: () => logger,
    getCurrentReqId: vi.fn(() => 'req-1'),
    withRequestLogging: (fn: unknown) => fn
  }
})

vi.mock('@/lib/activity-log', () => ({
  logActivity: { fireAndForget: vi.fn() },
  ActivityEvent: new Proxy({}, { get: (_t, key) => String(key) })
}))

const handlers = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn()
}))

vi.mock('@/lib/mcp/route-manifest', () => ({
  routeManifest: {
    '/api/things/{id}': async () => ({ GET: handlers.get, PUT: handlers.put }),
    '/api/things': async () => ({ POST: handlers.post, GET: 'not a handler' })
  }
}))

import { dispatchOperation } from '@/lib/mcp/dispatch'
import { getCurrentReqId } from '@/lib/logger'
import type { CatalogOperation } from '@/lib/mcp/catalog'
import type { McpCaller } from '@/lib/mcp/types'
import { McpToolError } from '@/lib/mcp/types'

const op = (over: Partial<CatalogOperation>): CatalogOperation => ({
  operationId: 'things.get',
  method: 'GET',
  path: '/api/things/{id}',
  summary: '',
  description: '',
  tag: null,
  requiredRole: 'USER',
  security: 'bearer',
  pathParams: ['id'],
  queryParams: [],
  body: 'none',
  inputSchema: { type: 'object', properties: {} },
  ...over
})

const getThing = op({ queryParams: ['limit', 'tag', 'flag', 'skip'] })
const putThing = op({
  operationId: 'things.update',
  method: 'PUT',
  body: 'flat'
})
const postThing = op({
  operationId: 'things.create',
  method: 'POST',
  path: '/api/things',
  pathParams: [],
  body: 'nested'
})

const inbound = new Request('https://wallet.example/api/mcp', {
  method: 'POST',
  headers: {
    host: 'wallet.example',
    'x-forwarded-for': '203.0.113.7, 10.0.0.1',
    'x-forwarded-proto': 'https',
    'x-real-ip': '203.0.113.7',
    'cf-connecting-ip': '203.0.113.7',
    'user-agent': 'claude-code/2',
    authorization: 'Bearer lwat_outer',
    cookie: 'session=1',
    'mcp-session-id': 'abc'
  }
})

const caller = (over: Partial<McpCaller> = {}): McpCaller => ({
  user: { pubkey: 'a'.repeat(64), userId: 'u1', role: 'USER' as never },
  scopes: new Set(['read', 'write']),
  grant: null,
  authorization: 'Bearer internal.jwt',
  apiUrl: 'https://wallet.example',
  request: inbound,
  ...over
})

/** The request and params the handler was called with. */
function received(handler: ReturnType<typeof vi.fn>) {
  const [request, context] = handler.mock.calls.at(-1) as [
    NextRequest,
    { params: Promise<Record<string, string>> }
  ]
  return { request, params: context.params }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const handler of Object.values(handlers)) {
    handler.mockImplementation(async () => Response.json({ ok: true }))
  }
})

describe('dispatchOperation — request mapping', () => {
  it('fills path and query parameters and forwards client headers', async () => {
    const result = await dispatchOperation(
      getThing,
      { id: 'abc', limit: 5, tag: ['a', 'b'], flag: true, skip: null },
      caller()
    )

    expect(result).toEqual({ status: 200, body: { ok: true } })
    const { request, params } = received(handlers.get)
    expect(request.method).toBe('GET')
    expect(request.url).toBe(
      'https://wallet.example/api/things/abc?limit=5&tag=a&tag=b&flag=true'
    )
    expect(await params).toEqual({ id: 'abc' })
    expect(request.headers.get('authorization')).toBe('Bearer internal.jwt')
    expect(request.headers.get('host')).toBe('wallet.example')
    expect(request.headers.get('x-forwarded-for')).toBe('203.0.113.7, 10.0.0.1')
    expect(request.headers.get('x-forwarded-proto')).toBe('https')
    expect(request.headers.get('x-real-ip')).toBe('203.0.113.7')
    expect(request.headers.get('cf-connecting-ip')).toBe('203.0.113.7')
    expect(request.headers.get('user-agent')).toBe('claude-code/2')
    expect(request.headers.get('x-request-id')).toBe('req-1')
    expect(request.headers.get('cookie')).toBeNull()
    expect(request.headers.get('mcp-session-id')).toBeNull()
    expect(request.headers.get('content-type')).toBeNull()
  })

  it('sends body fields next to path parameters as a JSON body', async () => {
    await dispatchOperation(
      putThing,
      { id: 'abc', name: 'New', extra: 1 },
      caller()
    )
    const { request, params } = received(handlers.put)
    expect(request.method).toBe('PUT')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(await request.json()).toEqual({ name: 'New', extra: 1 })
    expect(await params).toEqual({ id: 'abc' })
  })

  it('sends a nested body as-is, and nothing when it is absent', async () => {
    await dispatchOperation(postThing, { body: { a: 1 } }, caller())
    expect(await received(handlers.post).request.json()).toEqual({ a: 1 })

    await dispatchOperation(postThing, {}, caller())
    expect(await received(handlers.post).request.text()).toBe('')
  })

  it('never forwards the inbound credential of an anonymous caller', async () => {
    vi.mocked(getCurrentReqId).mockReturnValueOnce(undefined)
    await dispatchOperation(
      getThing,
      { id: 'abc' },
      caller({ user: null, authorization: null })
    )
    const { request } = received(handlers.get)
    expect(request.headers.get('authorization')).toBeNull()
    expect(request.headers.get('x-request-id')).toBeNull()
  })

  it('rejects arguments the operation does not take', async () => {
    await expect(
      dispatchOperation(getThing, { id: 'abc', admin: true }, caller())
    ).rejects.toThrow(new McpToolError('Unknown argument(s): admin'))
    await expect(
      dispatchOperation(postThing, { stray: 1 }, caller())
    ).rejects.toThrow('Unknown argument(s): stray')
  })

  it('rejects structured query values', async () => {
    await expect(
      dispatchOperation(getThing, { id: 'abc', limit: { $gt: 1 } }, caller())
    ).rejects.toThrow('"limit" must be a string, number or boolean')
  })
})

describe('dispatchOperation — path injection', () => {
  it.each([
    ['../settings', '/api/things/..%2Fsettings'],
    ['a/b', '/api/things/a%2Fb'],
    ['x?admin=1#frag', '/api/things/x%3Fadmin%3D1%23frag'],
    ['%2e%2e', '/api/things/%252e%252e'],
    [42, '/api/things/42']
  ])('keeps %j inside its own segment', async (id, pathname) => {
    await dispatchOperation(getThing, { id }, caller())
    const { request, params } = received(handlers.get)
    const url = new URL(request.url)
    expect(url.pathname).toBe(pathname)
    expect(url.search).toBe('')
    expect(url.hash).toBe('')
    expect(await params).toEqual({ id: String(id) })
    expect(handlers.put).not.toHaveBeenCalled()
  })

  it.each([['..'], ['.'], [''], [undefined], [null], [{}], [Infinity]])(
    'refuses %j as a path segment',
    async id => {
      await expect(
        dispatchOperation(getThing, { id }, caller())
      ).rejects.toThrow('"id" must be a non-empty path segment')
      expect(handlers.get).not.toHaveBeenCalled()
    }
  )
})

describe('dispatchOperation — responses', () => {
  it('returns error statuses with their body', async () => {
    handlers.get.mockResolvedValue(
      Response.json(
        { success: false, error: { message: 'Card not found' } },
        { status: 404 }
      )
    )
    expect(await dispatchOperation(getThing, { id: 'x' }, caller())).toEqual({
      status: 404,
      body: { success: false, error: { message: 'Card not found' } }
    })
  })

  it('passes text through and maps an empty body to null', async () => {
    handlers.get.mockResolvedValueOnce(new Response('plain text'))
    expect(
      (await dispatchOperation(getThing, { id: 'x' }, caller())).body
    ).toBe('plain text')

    handlers.get.mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect(await dispatchOperation(getThing, { id: 'x' }, caller())).toEqual({
      status: 204,
      body: null
    })
  })

  it('sanitizes a handler that throws instead of answering', async () => {
    handlers.get.mockRejectedValue(new Error('SELECT * FROM secrets'))
    const result = await dispatchOperation(getThing, { id: 'x' }, caller())
    expect(result.status).toBe(500)
    expect(JSON.stringify(result.body)).not.toContain('secrets')
    expect(result.body).toMatchObject({
      success: false,
      error: { message: 'Internal server error' }
    })
  })

  it('fails when the manifest has no handler for the operation', async () => {
    await expect(
      dispatchOperation(
        op({ path: '/api/unknown/{id}' }),
        { id: 'x' },
        caller()
      )
    ).rejects.toThrow('No GET handler for /api/unknown/{id}')
    await expect(
      dispatchOperation(
        op({ path: '/api/things', pathParams: [] }),
        {},
        caller()
      )
    ).rejects.toThrow('No GET handler for /api/things')
  })
})
