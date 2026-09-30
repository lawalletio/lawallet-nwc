import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxJsonSize: 4096, maxBodySize: 4096 }
  }))
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
    getCurrentReqId: () => undefined,
    withRequestLogging: (fn: unknown) => fn
  }
})

vi.mock('@/lib/activity-log', () => ({
  logActivity: { fireAndForget: vi.fn() },
  ActivityEvent: new Proxy({}, { get: (_t, key) => String(key) })
}))

vi.mock('@/lib/middleware/rate-limit', () => ({ rateLimit: vi.fn() }))

vi.mock('@/lib/mcp/tools', () => ({
  listTools: vi.fn(() => [{ name: 'echo' }]),
  hasTool: vi.fn((name: string) => name === 'echo' || name === 'ünï'),
  callTool: vi.fn(async () => ({
    content: [{ type: 'text', text: '"hi"' }],
    isError: false
  }))
}))

import {
  INSTRUCTIONS,
  LEGACY_PROTOCOL_VERSIONS,
  SUPPORTED_PROTOCOL_VERSIONS,
  handleMcpPost,
  type McpEndpoint
} from '@/lib/mcp/protocol'
import { McpAuthError } from '@/lib/mcp/caller'
import { callTool, listTools } from '@/lib/mcp/tools'
import { rateLimit } from '@/lib/middleware/rate-limit'
import { logger } from '@/lib/logger'
import { TooManyRequestsError } from '@/types/server/errors'
import type { McpCaller } from '@/lib/mcp/types'

const theCaller = { user: null, scopes: new Set() } as unknown as McpCaller

const endpoint: McpEndpoint = {
  resolveCaller: vi.fn(async () => theCaller),
  cacheScope: 'private'
}

async function post(
  body: unknown,
  headers: Record<string, string> = {},
  target: McpEndpoint = endpoint
) {
  const res = await handleMcpPost(
    new Request('https://wallet.example/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    }),
    target
  )
  const text = await res.text()
  return {
    status: res.status,
    headers: res.headers,
    text,
    body: text ? JSON.parse(text) : null
  }
}

const rpc = (method: string, params?: unknown, id: unknown = 1) => ({
  jsonrpc: '2.0',
  id,
  method,
  ...(params === undefined ? {} : { params })
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(endpoint.resolveCaller).mockResolvedValue(theCaller)
})

describe('legacy era', () => {
  it.each(LEGACY_PROTOCOL_VERSIONS)('initialize echoes %s', async version => {
    const { status, body } = await post(
      rpc('initialize', { protocolVersion: version })
    )
    expect(status).toBe(200)
    expect(body.result.protocolVersion).toBe(version)
  })

  it.each([['1999-01-01'], ['2026-07-28'], [42], [undefined]])(
    'initialize answers 2025-11-25 to %j',
    async version => {
      const { body } = await post(
        rpc('initialize', { protocolVersion: version })
      )
      expect(body.result.protocolVersion).toBe('2025-11-25')
    }
  )

  it('initialize describes the server', async () => {
    const { body } = await post(
      rpc('initialize', { protocolVersion: '2025-06-18' })
    )
    expect(body).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        resultType: 'complete',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'lawallet-nwc', title: 'LaWallet' },
        instructions: INSTRUCTIONS
      }
    })
    expect(body.result.serverInfo.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('keeps the essentials of the instructions in 500 characters', () => {
    const head = INSTRUCTIONS.slice(0, 500)
    for (const word of ['LaWallet', 'sats', 'spend', 'budget', 'untrusted']) {
      expect(head).toContain(word)
    }
  })

  it('answers ping', async () => {
    const { status, body } = await post(rpc('ping', undefined, 'p-1'))
    expect(status).toBe(200)
    expect(body.id).toBe('p-1')
    expect(body.result.resultType).toBe('complete')
  })

  it('accepts notifications with 202 and no body', async () => {
    const res = await post({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    })
    expect(res.status).toBe(202)
    expect(res.text).toBe('')
    // Still authenticated: 401 applies to every message on /api/mcp.
    expect(endpoint.resolveCaller).toHaveBeenCalled()
  })

  it('lists tools for the resolved caller', async () => {
    const { body } = await post(rpc('tools/list'))
    expect(listTools).toHaveBeenCalledWith(theCaller)
    expect(body.result).toMatchObject({
      tools: [{ name: 'echo' }],
      ttlMs: 60000,
      cacheScope: 'private'
    })
  })

  it('calls a tool', async () => {
    const { status, body } = await post(
      rpc('tools/call', { name: 'echo', arguments: { a: 1 } })
    )
    expect(status).toBe(200)
    expect(callTool).toHaveBeenCalledWith('echo', { a: 1 }, theCaller)
    expect(body.result).toMatchObject({
      content: [{ type: 'text', text: '"hi"' }],
      isError: false,
      resultType: 'complete'
    })
  })

  it('defaults missing arguments to an empty object', async () => {
    await post(rpc('tools/call', { name: 'echo' }))
    expect(callTool).toHaveBeenCalledWith('echo', {}, theCaller)
  })

  it.each([
    [{ name: 'nope' }, 'Unknown tool: nope'],
    [{ name: 7 }, 'Unknown tool: 7'],
    [
      { name: 'echo', arguments: [1] },
      'Invalid params: arguments must be an object'
    ],
    [
      { name: 'echo', arguments: 'x' },
      'Invalid params: arguments must be an object'
    ]
  ])('tools/call %j → -32602', async (params, message) => {
    const { status, body } = await post(rpc('tools/call', params))
    expect(status).toBe(200)
    expect(body.error).toEqual({ code: -32602, message })
    expect(callTool).not.toHaveBeenCalled()
  })

  it.each(['resources/list', 'server/discover'])(
    'answers unknown method %s with -32601',
    async method => {
      const { status, body } = await post(rpc(method, {}, 9))
      expect(status).toBe(200)
      expect(body).toEqual({
        jsonrpc: '2.0',
        id: 9,
        error: { code: -32601, message: `Method not found: ${method}` }
      })
    }
  )

  it('echoes string and numeric ids exactly', async () => {
    for (const id of ['abc-1', '', 0, 42, -3, 1.5]) {
      expect((await post(rpc('ping', undefined, id))).body.id).toBe(id)
    }
  })

  it('accepts a legacy MCP-Protocol-Version header', async () => {
    const { status } = await post(rpc('tools/list'), {
      'mcp-protocol-version': '2025-06-18'
    })
    expect(status).toBe(200)
  })

  it('refuses a header naming a revision it does not serve', async () => {
    const { status, body } = await post(rpc('tools/list'), {
      'mcp-protocol-version': '1999-01-01'
    })
    expect(status).toBe(400)
    expect(body.error).toEqual({
      code: -32022,
      message: 'Unsupported protocol version',
      data: { supported: SUPPORTED_PROTOCOL_VERSIONS, requested: '1999-01-01' }
    })
    expect(endpoint.resolveCaller).not.toHaveBeenCalled()
  })

  it('refuses a 2026-07-28 header on a body without _meta', async () => {
    const { status, body } = await post(rpc('tools/list'), {
      'mcp-protocol-version': '2026-07-28'
    })
    expect(status).toBe(400)
    expect(body.error.code).toBe(-32602)
  })
})

describe('malformed input', () => {
  it.each([['{"jsonrpc":'], ['']])('parse error for %j', async raw => {
    const { status, body } = await post(raw)
    expect(status).toBe(400)
    expect(body).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' }
    })
    expect(endpoint.resolveCaller).not.toHaveBeenCalled()
  })

  it.each([
    ['a string', '"hello"', null],
    ['a number', '1', null],
    ['null', 'null', null],
    ['no jsonrpc', JSON.stringify({ id: 5, method: 'ping' }), 5],
    [
      'a wrong jsonrpc',
      JSON.stringify({ jsonrpc: '1.0', id: 'x', method: 'ping' }),
      'x'
    ],
    ['no method', JSON.stringify({ jsonrpc: '2.0', id: 3 }), 3],
    [
      'a null id',
      JSON.stringify({ jsonrpc: '2.0', id: null, method: 'ping' }),
      null
    ],
    [
      'an object id',
      JSON.stringify({ jsonrpc: '2.0', id: {}, method: 'ping' }),
      null
    ]
  ])('invalid request: %s', async (_label, raw, id) => {
    const { status, body } = await post(raw)
    expect(status).toBe(400)
    expect(body.id).toBe(id)
    expect(body.error.code).toBe(-32600)
  })

  it('refuses non-object params', async () => {
    const { status, body } = await post(rpc('ping', [1, 2]))
    expect(status).toBe(400)
    expect(body.error).toEqual({
      code: -32602,
      message: 'Invalid params: expected an object'
    })
  })

  it('answers an oversized body with 413', async () => {
    const res = await post(rpc('ping', { pad: 'x'.repeat(5000) }))
    expect(res.status).toBe(413)
  })
})

describe('batches (2025-03-26)', () => {
  it('answers with an array, skipping notifications', async () => {
    const { status, body } = await post([
      rpc('ping', undefined, 1),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { id: 2 },
      rpc('tools/list', undefined, 3)
    ])
    expect(status).toBe(200)
    expect(body.map((r: { id: unknown }) => r.id)).toEqual([1, 2, 3])
    expect(body[1].error.code).toBe(-32600)
    expect(body[2].result.tools).toEqual([{ name: 'echo' }])
  })

  it('answers a batch of notifications with 202', async () => {
    const res = await post([
      { jsonrpc: '2.0', method: 'notifications/initialized' }
    ])
    expect(res.status).toBe(202)
  })

  it.each([
    [[]],
    [Array.from({ length: 21 }, (_, i) => rpc('ping', undefined, i))]
  ])('refuses a batch of %# messages', async batch => {
    const { status, body } = await post(batch)
    expect(status).toBe(400)
    expect(body.error.code).toBe(-32600)
  })
})

describe('authentication and failures', () => {
  it('answers 401 on every method, including initialize', async () => {
    vi.mocked(endpoint.resolveCaller).mockRejectedValue(
      new McpAuthError(
        'unauthorized',
        'Authorization required',
        'https://w.example'
      )
    )
    for (const message of [
      rpc('initialize', { protocolVersion: '2025-11-25' }),
      rpc('tools/list'),
      { jsonrpc: '2.0', method: 'notifications/initialized' }
    ]) {
      const res = await post(message)
      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toMatch(
        /^Bearer resource_metadata=/
      )
      expect(res.body).toEqual({
        error: 'unauthorized',
        error_description: 'Authorization required'
      })
    }
  })

  it('rate limits per caller', async () => {
    const identified = {
      ...theCaller,
      user: { pubkey: 'f'.repeat(64), userId: 'u', role: 'USER' }
    } as McpCaller
    vi.mocked(endpoint.resolveCaller).mockResolvedValueOnce(identified)
    await post(rpc('ping'))
    expect(rateLimit).toHaveBeenCalledWith(expect.any(Request), {
      bucket: 'mcp',
      identifier: 'f'.repeat(64),
      isAuthenticated: true
    })

    vi.mocked(rateLimit).mockRejectedValueOnce(
      new TooManyRequestsError('Rate limit exceeded. Please try again later.', {
        retryAfter: 30
      })
    )
    const limited = await post(rpc('ping'))
    expect(limited.status).toBe(429)
    expect(limited.headers.get('Retry-After')).toBe('30')
  })

  it('never answers a well-formed request with a 5xx', async () => {
    vi.mocked(endpoint.resolveCaller).mockRejectedValueOnce(
      new Error('db down')
    )
    const unresolved = await post([
      rpc('ping', undefined, 1),
      rpc('tools/list', undefined, 2)
    ])
    expect(unresolved.status).toBe(200)
    expect(unresolved.body).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32603, message: 'Internal error' }
      },
      {
        jsonrpc: '2.0',
        id: 2,
        error: { code: -32603, message: 'Internal error' }
      }
    ])

    vi.mocked(listTools).mockImplementationOnce(() => {
      throw new Error('catalog broken')
    })
    const crashed = await post(rpc('tools/list', undefined, 'x'))
    expect(crashed.status).toBe(200)
    expect(crashed.body.error).toEqual({
      code: -32603,
      message: 'Internal error'
    })
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('modern era (2026-07-28)', () => {
  const META = {
    'io.modelcontextprotocol/protocolVersion': '2026-07-28',
    'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' },
    'io.modelcontextprotocol/clientCapabilities': {}
  }

  const modern = (
    method: string,
    params: Record<string, unknown> = {},
    headers: Record<string, string | null> = {},
    meta: Record<string, unknown> = META
  ) => {
    const merged: Record<string, string> = {}
    const base: Record<string, string | null> = {
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(method === 'tools/call' && typeof params.name === 'string'
        ? { 'mcp-name': params.name }
        : {}),
      ...headers
    }
    for (const [k, v] of Object.entries(base)) if (v !== null) merged[k] = v
    return post(rpc(method, { ...params, _meta: meta }), merged)
  }

  it('answers server/discover', async () => {
    const { status, body } = await modern('server/discover')
    expect(status).toBe(200)
    expect(body.result).toEqual({
      resultType: 'complete',
      supportedVersions: [
        '2026-07-28',
        '2025-11-25',
        '2025-06-18',
        '2025-03-26',
        '2024-11-05'
      ],
      capabilities: { tools: {} },
      instructions: INSTRUCTIONS,
      ttlMs: 60000,
      cacheScope: 'public',
      _meta: {
        'io.modelcontextprotocol/serverInfo': {
          name: 'lawallet-nwc',
          version: expect.stringMatching(/^\d+\.\d+\.\d+/)
        }
      }
    })
  })

  it('lists tools with caching hints: private per token, public anonymously', async () => {
    const { body } = await modern('tools/list')
    expect(body.result).toMatchObject({
      resultType: 'complete',
      tools: [{ name: 'echo' }],
      ttlMs: 60000,
      cacheScope: 'private',
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'lawallet-nwc' } }
    })
    const publicList = await post(
      rpc('tools/list', { _meta: META }),
      { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' },
      { ...endpoint, cacheScope: 'public' }
    )
    expect(publicList.body.result.cacheScope).toBe('public')
  })

  it('calls a tool when the headers mirror the body', async () => {
    const { status, body } = await modern('tools/call', {
      name: 'echo',
      arguments: { a: 1 }
    })
    expect(status).toBe(200)
    expect(callTool).toHaveBeenCalledWith('echo', { a: 1 }, theCaller)
    expect(body.result).toMatchObject({
      isError: false,
      resultType: 'complete'
    })
  })

  it('decodes a base64-sentinel Mcp-Name before comparing', async () => {
    const encoded = `=?base64?${Buffer.from('ünï').toString('base64')}?=`
    const { status } = await modern(
      'tools/call',
      { name: 'ünï' },
      { 'mcp-name': encoded }
    )
    expect(status).toBe(200)
    expect(callTool).toHaveBeenCalledWith('ünï', {}, theCaller)
  })

  it.each([
    [
      'a missing MCP-Protocol-Version',
      'tools/list',
      {},
      { 'mcp-protocol-version': null }
    ],
    [
      'a different MCP-Protocol-Version',
      'tools/list',
      {},
      { 'mcp-protocol-version': '2025-11-25' }
    ],
    ['a missing Mcp-Method', 'tools/list', {}, { 'mcp-method': null }],
    [
      'a different Mcp-Method',
      'tools/list',
      {},
      { 'mcp-method': 'tools/call' }
    ],
    [
      'a missing Mcp-Name',
      'tools/call',
      { name: 'echo' },
      { 'mcp-name': null }
    ],
    [
      'a different Mcp-Name',
      'tools/call',
      { name: 'echo' },
      { 'mcp-name': 'other' }
    ],
    [
      'a malformed base64 Mcp-Name',
      'tools/call',
      { name: 'echo' },
      { 'mcp-name': '=?base64?***?=' }
    ],
    [
      'a base64 Mcp-Name of another tool',
      'tools/call',
      { name: 'echo' },
      { 'mcp-name': '=?base64?b3RoZXI=?=' }
    ]
  ])('refuses %s with -32020', async (_label, method, params, headers) => {
    const { status, body } = await modern(method, params, headers)
    expect(status).toBe(400)
    expect(body.error.code).toBe(-32020)
    expect(body.id).toBe(1)
    expect(endpoint.resolveCaller).not.toHaveBeenCalled()
  })

  it('refuses an unsupported version with the supported list', async () => {
    const { status, body } = await modern(
      'tools/list',
      {},
      { 'mcp-protocol-version': '2027-01-01' },
      { ...META, 'io.modelcontextprotocol/protocolVersion': '2027-01-01' }
    )
    expect(status).toBe(400)
    expect(body.error).toEqual({
      code: -32022,
      message: 'Unsupported protocol version',
      data: { supported: SUPPORTED_PROTOCOL_VERSIONS, requested: '2027-01-01' }
    })
  })

  it.each([[undefined], ['none']])(
    'refuses clientCapabilities %j with -32602',
    async capabilities => {
      const { status, body } = await modern(
        'tools/list',
        {},
        {},
        {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': capabilities
        }
      )
      expect(status).toBe(400)
      expect(body.error.code).toBe(-32602)
    }
  )

  it.each(['resources/list', 'initialize', 'ping'])(
    'answers unknown modern method %s with 404',
    async method => {
      const { status, body } = await modern(method)
      expect(status).toBe(404)
      expect(body.error.code).toBe(-32601)
    }
  )

  it('answers an unknown tool with 400', async () => {
    const { status, body } = await modern('tools/call', { name: 'nope' })
    expect(status).toBe(400)
    expect(body.error).toEqual({ code: -32602, message: 'Unknown tool: nope' })
  })

  it('accepts a modern notification with 202', async () => {
    const res = await post({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { _meta: META }
    })
    expect(res.status).toBe(202)
  })

  it('challenges an unauthenticated modern request with 401 after validation', async () => {
    vi.mocked(endpoint.resolveCaller).mockRejectedValue(
      new McpAuthError(
        'unauthorized',
        'Authorization required',
        'https://w.example'
      )
    )
    expect((await modern('server/discover')).status).toBe(401)
    expect((await modern('tools/list', {}, { 'mcp-method': 'x' })).status).toBe(
      400
    )
  })
})
