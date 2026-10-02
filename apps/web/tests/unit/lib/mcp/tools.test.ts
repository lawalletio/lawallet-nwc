import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/tests/helpers/prisma-mock'

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
    getCurrentReqId: () => undefined,
    withRequestLogging: (fn: unknown) => fn
  }
})

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/mcp/dispatch', () => ({ dispatchOperation: vi.fn() }))
vi.mock('@/lib/public-url', () => ({
  resolveAddressDomain: vi.fn(async () => 'example.com')
}))

const native = vi.hoisted(() => ({ read: vi.fn(), spend: vi.fn() }))

vi.mock('@/lib/mcp/wallet-tools', () => {
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true
  }
  const inputSchema = { type: 'object', properties: {} }
  return {
    readSpendBudget: vi.fn(async (_id: string, limitSats: number) => ({
      limitSats,
      spentLast24hSats: 100,
      remainingSats: limitSats - 100
    })),
    walletTools: [
      {
        name: 'wallet_read_tool',
        title: 'Read tool',
        description: 'Reads.',
        inputSchema,
        annotations,
        scope: 'read',
        handler: native.read
      },
      {
        name: 'wallet_spend_tool',
        title: 'Spend tool',
        description: 'Spends.',
        inputSchema,
        annotations: {
          ...annotations,
          readOnlyHint: false,
          destructiveHint: true
        },
        scope: 'spend',
        handler: native.spend
      }
    ]
  }
})

import { MAX_RESULT_CHARS, callTool, hasTool, listTools } from '@/lib/mcp/tools'
import { dispatchOperation } from '@/lib/mcp/dispatch'
import { checkMaintenance } from '@/lib/middleware/maintenance'
import { logger } from '@/lib/logger'
import { McpToolError, type McpCaller } from '@/lib/mcp/types'
import { NotFoundError, ServiceUnavailableError } from '@/types/server/errors'
import { Role } from '@/lib/auth/permissions'
import type { OAuthScope } from '@/lib/oauth/constants'

const PUBKEY = 'a'.repeat(64)
const NWC = `nostr+walletconnect://${'b'.repeat(64)}?relay=wss%3A%2F%2Fr.example&secret=${'c'.repeat(64)}`

function caller(
  role: Role | null,
  scopes: OAuthScope[] = [],
  grant: McpCaller['grant'] = null
): McpCaller {
  return {
    user: role ? { pubkey: PUBKEY, userId: 'u1', role } : null,
    scopes: new Set(scopes),
    grant,
    authorization: role ? 'Bearer internal.jwt' : null,
    apiUrl: 'https://wallet.example',
    request: new Request('https://wallet.example/api/mcp', { method: 'POST' })
  }
}

const oauthGrant = { id: 'g1', clientName: 'Claude', spendLimitSats: 5000 }
const anonymous = caller(null)
const reader = caller(Role.USER, ['read'], {
  ...oauthGrant,
  spendLimitSats: null
})
const writer = caller(Role.USER, ['read', 'write'], {
  ...oauthGrant,
  spendLimitSats: null
})
const session = caller(Role.USER, ['read', 'write'])
const viewer = caller(Role.VIEWER, ['read'], oauthGrant)
const admin = caller(Role.ADMIN, ['read', 'write', 'spend'], oauthGrant)

const names = (c: McpCaller) => listTools(c).map(tool => tool.name)

async function call(name: string, args: Record<string, unknown>, c: McpCaller) {
  const result = await callTool(name, args, c)
  return { isError: result.isError, text: result.content[0].text }
}

const json = (text: string) => JSON.parse(text)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(dispatchOperation).mockResolvedValue({
    status: 200,
    body: { ok: true }
  })
})

describe('listTools', () => {
  const PUBLIC = [
    'get_instance_info',
    'resolve_lightning_address',
    'request_address_invoice',
    'verify_address_payment',
    'check_address_availability'
  ]
  const USER_READS = [
    'get_my_account',
    'list_lightning_addresses',
    'get_lightning_address',
    'list_address_invoices',
    'list_wallets',
    'list_my_cards'
  ]

  it('offers anonymous callers public tools only', () => {
    expect(names(anonymous)).toEqual([
      ...PUBLIC,
      'api_list_operations',
      'api_read'
    ])
  })

  it('filters by scope for a read-only user', () => {
    expect(names(reader)).toEqual([
      ...PUBLIC,
      ...USER_READS,
      'get_settings',
      'wallet_read_tool',
      'api_list_operations',
      'api_read'
    ])
  })

  it('adds write tools with the write scope, but never spend for a session', () => {
    for (const c of [writer, session]) {
      const list = names(c)
      expect(list).toContain('create_lightning_address')
      expect(list).toContain('api_write')
      expect(list).not.toContain('wallet_spend_tool')
      expect(list).not.toContain('list_cards')
    }
  })

  it('filters by role', () => {
    const list = names(viewer)
    for (const name of [
      'list_cards',
      'get_card',
      'list_users',
      'list_activity'
    ]) {
      expect(list).toContain(name)
    }
    expect(list).not.toContain('api_write')
  })

  it('gives an admin with every scope the full set, in a stable order', () => {
    const list = names(admin)
    expect(list).toEqual([
      ...PUBLIC,
      ...USER_READS,
      'list_cards',
      'get_card',
      'list_users',
      'list_activity',
      'get_settings',
      'create_lightning_address',
      'wallet_read_tool',
      'wallet_spend_tool',
      'api_list_operations',
      'api_read',
      'api_write'
    ])
    expect(names(admin)).toEqual(list)
  })

  it('describes every tool in a way hosts accept', () => {
    const tools = listTools(admin)
    expect(new Set(tools.map(t => t.name)).size).toBe(tools.length)
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z0-9_]{1,64}$/)
      expect(tool.title.length).toBeGreaterThan(0)
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.description.length).toBeLessThanOrEqual(1000)
      expect(tool.inputSchema.type).toBe('object')
      expect(JSON.stringify(tool.inputSchema)).not.toContain('"$ref"')
      for (const hint of [
        'readOnlyHint',
        'destructiveHint',
        'openWorldHint'
      ] as const) {
        expect(typeof tool.annotations[hint], `${tool.name}.${hint}`).toBe(
          'boolean'
        )
      }
    }
    const byName = Object.fromEntries(tools.map(t => [t.name, t.annotations]))
    expect(byName.api_read.readOnlyHint).toBe(true)
    expect(byName.api_write).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true
    })
    expect(byName.request_address_invoice).toMatchObject({
      readOnlyHint: false,
      openWorldHint: true
    })
    expect(byName.get_my_account).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    })
  })

  it('knows every tool name, whoever asks', () => {
    expect(hasTool('api_write')).toBe(true)
    expect(hasTool('wallet_spend_tool')).toBe(true)
    expect(hasTool('update_lightning_address')).toBe(false)
  })
})

describe('callTool — promoted operations', () => {
  it('dispatches with the caller and returns the body', async () => {
    vi.mocked(dispatchOperation).mockResolvedValue({
      status: 200,
      body: [{ id: 'w1', name: 'Main' }]
    })
    const result = await call('list_wallets', { status: 'ACTIVE' }, reader)
    expect(result).toEqual({
      isError: false,
      text: JSON.stringify([{ id: 'w1', name: 'Main' }])
    })
    const [op, args, c] = vi.mocked(dispatchOperation).mock.calls[0]
    expect(op.operationId).toBe('remoteWallets.list')
    expect(args).toEqual({ status: 'ACTIVE' })
    expect(c).toBe(reader)
  })

  it('refuses a role that is too low', async () => {
    const result = await call('list_cards', {}, reader)
    expect(result.isError).toBe(true)
    expect(json(result.text).error).toBe(
      'cards.list requires the VIEWER role; this account is USER.'
    )
    expect(dispatchOperation).not.toHaveBeenCalled()
  })

  it('refuses a write without the write scope', async () => {
    const result = await call(
      'create_lightning_address',
      { username: 'x' },
      reader
    )
    expect(result.isError).toBe(true)
    expect(json(result.text).error).toMatch(/needs the "write" scope/)
    expect(dispatchOperation).not.toHaveBeenCalled()
  })

  it('sends anonymous callers to the authenticated endpoint', async () => {
    const result = await call('get_my_account', {}, anonymous)
    expect(json(result.text).error).toBe(
      'Sign-in required: connect an MCP client to https://wallet.example/api/mcp to use this.'
    )
  })

  it('lets anyone call a public operation', async () => {
    const result = await call(
      'check_address_availability',
      { username: 'bob' },
      anonymous
    )
    expect(result.isError).toBe(false)
    expect(vi.mocked(dispatchOperation).mock.calls[0][0].operationId).toBe(
      'lightningAddresses.check'
    )
  })

  it('returns REST errors as isError results with their status', async () => {
    vi.mocked(dispatchOperation).mockResolvedValueOnce({
      status: 404,
      body: { success: false, error: { message: 'Address not found' } }
    })
    const result = await call(
      'get_lightning_address',
      { username: 'x' },
      reader
    )
    expect(result.isError).toBe(true)
    expect(json(result.text)).toEqual({
      status: 404,
      success: false,
      error: { message: 'Address not found' }
    })

    vi.mocked(dispatchOperation).mockResolvedValueOnce({
      status: 502,
      body: 'Bad gateway'
    })
    expect(
      json(
        (await call('get_lightning_address', { username: 'x' }, reader)).text
      )
    ).toEqual({
      status: 502,
      body: 'Bad gateway'
    })
  })

  it('redacts secrets from REST results', async () => {
    vi.mocked(dispatchOperation).mockResolvedValue({
      status: 200,
      body: { userId: 'u1', nwcString: NWC, effectiveNwcString: NWC }
    })
    const { text } = await call('get_my_account', {}, reader)
    expect(text).not.toContain('walletconnect')
    expect(json(text)).toEqual({
      userId: 'u1',
      nwcString: '[redacted]',
      effectiveNwcString: '[redacted]'
    })
  })

  it('caps long results and says how to narrow them', async () => {
    vi.mocked(dispatchOperation).mockResolvedValue({
      status: 200,
      body: { items: 'x'.repeat(MAX_RESULT_CHARS * 2) }
    })
    const { text, isError } = await call('list_activity', {}, viewer)
    expect(isError).toBe(false)
    expect(text.length).toBeLessThan(MAX_RESULT_CHARS + 300)
    expect(text).toMatch(/\[truncated: .*pagination/)
  })
})

describe('callTool — generic gateway', () => {
  it('reads any exposed operation by operationId', async () => {
    const result = await call(
      'api_read',
      { operationId: 'cards.get', params: { id: 'c1' } },
      viewer
    )
    expect(result.isError).toBe(false)
    const [op, args] = vi.mocked(dispatchOperation).mock.calls[0]
    expect(op.operationId).toBe('cards.get')
    expect(args).toEqual({ id: 'c1' })
  })

  it('defaults params to an empty object', async () => {
    await call('api_read', { operationId: 'wallet.addresses.list' }, reader)
    expect(vi.mocked(dispatchOperation).mock.calls[0][1]).toEqual({})
  })

  it('keeps reads and writes apart', async () => {
    const write = await call('api_read', { operationId: 'cards.delete' }, admin)
    expect(json(write.text).error).toBe(
      'cards.delete is a write operation: call it with api_write.'
    )
    const read = await call('api_write', { operationId: 'cards.get' }, admin)
    expect(json(read.text).error).toBe(
      'cards.get is a read operation: call it with api_read.'
    )
    expect(dispatchOperation).not.toHaveBeenCalled()
  })

  it('never lets a read-only caller write', async () => {
    const result = await call(
      'api_write',
      { operationId: 'wallet.addresses.create', params: { username: 'x' } },
      reader
    )
    expect(result.isError).toBe(true)
    expect(json(result.text).error).toMatch(/needs the "write" scope/)
    expect(dispatchOperation).not.toHaveBeenCalled()
  })

  it.each([
    ['api_write', 'settings.update'],
    ['api_write', 'wallet.addresses.update'],
    ['api_write', 'remoteWallets.receiveAction.force'],
    ['api_write', 'remoteWallets.create'],
    ['api_write', 'users.role.set'],
    ['api_read', 'cards.otc.get'],
    ['api_write', 'auth.exchange'],
    ['api_read', 'cardDesigns.getById']
  ])('%s refuses excluded %s even by exact id', async (tool, operationId) => {
    const result = await call(tool, { operationId, params: {} }, admin)
    expect(result.isError).toBe(true)
    expect(json(result.text).error).toMatch(
      new RegExp(
        `^${operationId.replace(/\./g, '\\.')} is not available through MCP: `
      )
    )
    expect(dispatchOperation).not.toHaveBeenCalled()
  })

  it('does not know the MCP and OAuth endpoints at all', async () => {
    for (const operationId of ['oauth.authorize.decide', 'mcp.call']) {
      const result = await call('api_write', { operationId }, admin)
      expect(json(result.text).error).toMatch(/^Unknown operationId/)
    }
  })

  it('refuses protected operations to anonymous callers', async () => {
    const result = await call(
      'api_read',
      { operationId: 'users.me' },
      anonymous
    )
    expect(json(result.text).error).toMatch(/^Sign-in required/)
    const ok = await call(
      'api_read',
      { operationId: 'setup.status' },
      anonymous
    )
    expect(ok.isError).toBe(false)
  })

  it('explains bad arguments instead of failing the protocol', async () => {
    expect(json((await call('api_read', {}, reader)).text).error).toBe(
      'Unknown operationId undefined: call api_list_operations to find one.'
    )
    expect(
      json(
        (
          await call(
            'api_read',
            { operationId: 'cards.list', params: [1] },
            viewer
          )
        ).text
      ).error
    ).toBe('"params" must be an object')
  })

  it('surfaces argument errors from the dispatcher', async () => {
    vi.mocked(dispatchOperation).mockRejectedValue(
      new McpToolError('"id" must be a non-empty path segment')
    )
    const result = await call('get_card', { id: '..' }, viewer)
    expect(result).toEqual({
      isError: true,
      text: JSON.stringify({ error: '"id" must be a non-empty path segment' })
    })
  })
})

describe('callTool — api_list_operations', () => {
  const list = async (args: Record<string, unknown>, c: McpCaller) =>
    json((await call('api_list_operations', args, c)).text)

  it('lists only what the caller can call', async () => {
    const result = await list({ limit: 100 }, anonymous)
    const ids = result.operations.map(
      (op: { operationId: string }) => op.operationId
    )
    expect(ids).toContain('lightningAddresses.check')
    expect(ids).toContain('version.get')
    expect(ids).not.toContain('lud16.callback') // public, but a write
    expect(ids).not.toContain('users.me')
    expect(result.note).toMatch(/no "write" scope/)
  })

  it('never lists excluded operations or ones above the role', async () => {
    const adminIds = (await list({ limit: 100 }, admin)).operations.map(
      (op: { operationId: string }) => op.operationId
    )
    expect(adminIds).toContain('cards.delete')
    for (const id of [
      'settings.update',
      'wallet.addresses.update',
      'cards.write'
    ]) {
      expect(adminIds).not.toContain(id)
    }
    const userIds = (await list({ limit: 100 }, writer)).operations.map(
      (op: { operationId: string }) => op.operationId
    )
    expect(userIds).not.toContain('cards.list')
  })

  it('filters by words, tag and access, and limits the page', async () => {
    const vouchers = await list({ query: 'voucher settings' }, writer)
    expect(
      vouchers.operations.map((op: { operationId: string }) => op.operationId)
    ).toEqual([
      'wallet.vouchers.settings.get',
      'wallet.vouchers.settings.update'
    ])
    expect(vouchers.note).toBeUndefined()
    expect(vouchers.operations[1]).toMatchObject({
      method: 'PUT',
      access: 'write',
      tool: 'api_write',
      requiredRole: 'USER'
    })
    expect(vouchers.operations[1].inputSchema.type).toBe('object')

    const writes = await list(
      { access: 'write', tag: 'cards', limit: 100 },
      admin
    )
    expect(writes.operations.length).toBeGreaterThan(0)
    for (const op of writes.operations) {
      expect(op).toMatchObject({ access: 'write', tag: 'Cards' })
    }

    const page = await list({ limit: 2 }, admin)
    expect(page.operations).toHaveLength(2)
    expect(page.total).toBeGreaterThan(2)
  })
})

describe('callTool — native tools', () => {
  it('runs the handler behind the maintenance gate', async () => {
    native.read.mockResolvedValue({ balanceSats: BigInt(21) })
    const result = await call('wallet_read_tool', { walletId: 'w1' }, reader)
    expect(result).toEqual({ isError: false, text: '{"balanceSats":"21"}' })
    expect(native.read).toHaveBeenCalledWith({ walletId: 'w1' }, reader)
    const gate = vi.mocked(checkMaintenance).mock.calls[0][0]
    expect(gate.headers.get('authorization')).toBe('Bearer internal.jwt')
  })

  it('reports maintenance as a tool error', async () => {
    vi.mocked(checkMaintenance).mockRejectedValueOnce(
      new ServiceUnavailableError('Service is under maintenance')
    )
    const result = await call('wallet_read_tool', {}, reader)
    expect(result.isError).toBe(true)
    expect(json(result.text)).toMatchObject({
      status: 503,
      error: { message: 'Service is under maintenance' }
    })
    expect(native.read).not.toHaveBeenCalled()
  })

  it('returns McpToolError data next to the message', async () => {
    native.spend.mockRejectedValue(
      new McpToolError('Over budget', { remainingSats: 10 })
    )
    const result = await call('wallet_spend_tool', {}, admin)
    expect(result).toEqual({
      isError: true,
      text: JSON.stringify({ error: 'Over budget', remainingSats: 10 })
    })
  })

  it('maps API errors and hides unexpected ones', async () => {
    native.read.mockRejectedValueOnce(new NotFoundError('Wallet not found'))
    expect(
      json((await call('wallet_read_tool', {}, reader)).text)
    ).toMatchObject({
      status: 404,
      error: { message: 'Wallet not found' }
    })

    native.read.mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 10.0.0.5')
    )
    const hidden = await call('wallet_read_tool', {}, reader)
    expect(hidden.text).not.toContain('ECONNREFUSED')
    expect(json(hidden.text)).toMatchObject({
      status: 500,
      error: { message: 'Internal server error' }
    })
    expect(logger.error).toHaveBeenCalled()
  })

  it('explains why spending is unavailable', async () => {
    const viaSession = await call('wallet_spend_tool', {}, session)
    expect(json(viaSession.text).error).toMatch(
      /only an OAuth connection can grant/
    )
    const withoutScope = await call('wallet_spend_tool', {}, writer)
    expect(json(withoutScope.text).error).toMatch(/needs the "spend" scope/)
    expect(native.spend).not.toHaveBeenCalled()
  })

  it('logs the call without its arguments', async () => {
    native.read.mockResolvedValue({})
    await call('wallet_read_tool', { connection: NWC }, reader)
    const [entry, message] = vi.mocked(logger.info).mock.calls.at(-1)!
    expect(message).toBe('mcp.tool_call')
    expect(entry).toMatchObject({
      tool: 'wallet_read_tool',
      pubkey: 'aaaaaaaa…',
      client: 'Claude',
      outcome: 'ok'
    })
    expect(JSON.stringify(entry)).not.toContain('walletconnect')
  })

  it('answers an unknown name as a tool error', async () => {
    const result = await call('nope', {}, admin)
    expect(result).toEqual({
      isError: true,
      text: JSON.stringify({ error: 'Unknown tool: nope' })
    })
  })
})

describe('get_instance_info', () => {
  it('describes the instance to anyone', async () => {
    const info = json((await call('get_instance_info', {}, anonymous)).text)
    expect(info).toMatchObject({
      instanceUrl: 'https://wallet.example',
      mcpUrl: 'https://wallet.example/api/mcp',
      publicMcpUrl: 'https://wallet.example/api/mcp/public',
      addressDomain: 'example.com',
      connection: null
    })
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('adds who is connected and the spend budget', async () => {
    const info = json((await call('get_instance_info', {}, admin)).text)
    expect(info.connection).toEqual({
      pubkey: PUBKEY,
      role: 'ADMIN',
      scopes: ['read', 'write', 'spend'],
      via: 'oauth',
      clientName: 'Claude',
      spendBudget: {
        limitSats: 5000,
        spentLast24hSats: 100,
        remainingSats: 4900
      }
    })
    const viaSession = json((await call('get_instance_info', {}, session)).text)
    expect(viaSession.connection).toMatchObject({
      via: 'session token',
      clientName: null,
      spendBudget: null
    })
  })
})
