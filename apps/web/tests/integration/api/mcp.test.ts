import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  createRemoteWalletFixture,
  createUserFixture
} from '@/tests/helpers/fixtures'
import { createDefaultConfig } from '@/tests/helpers/route-helpers'
import { AuthenticationError } from '@/types/server/errors'

// End-to-end through both MCP routes: real protocol, caller resolution,
// catalog, policy, dispatch and REST handlers. Only the database, settings
// and the OAuth token lookup are faked.

vi.mock('@/lib/config', async () => {
  const { createDefaultConfig } = await import('@/tests/helpers/route-helpers')
  const config = createDefaultConfig()
  return { getConfig: vi.fn(() => config) }
})

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

vi.mock('@/lib/settings', () => ({ getSettings: vi.fn(async () => ({})) }))

vi.mock('@/lib/oauth/access-token', () => ({
  isOAuthAccessToken: (token: string) => token.startsWith('lwat_'),
  verifyAccessToken: vi.fn()
}))

// GET /api/users/me decrypts the primary wallet's connection string — the
// very secret the MCP layer must never hand to a model.
vi.mock('@/lib/wallet/primary-wallet', () => ({
  getPrimaryRemoteWalletForUser: vi.fn(async () => null)
}))
vi.mock('@/lib/wallet/remote-wallet-vault', () => ({
  decryptRemoteWalletConfig: vi.fn()
}))

import { POST as mcpPost } from '@/app/api/mcp/route'
import { POST as publicPost } from '@/app/api/mcp/public/route'
import { verifyAccessToken } from '@/lib/oauth/access-token'
import { getPrimaryRemoteWalletForUser } from '@/lib/wallet/primary-wallet'
import { decryptRemoteWalletConfig } from '@/lib/wallet/remote-wallet-vault'
import { createJwtToken } from '@/lib/jwt'

const PUBKEY = 'a'.repeat(64)
const NWC = `nostr+walletconnect://${'b'.repeat(64)}?relay=wss%3A%2F%2Fr.example&secret=${'c'.repeat(64)}`
const user = createUserFixture({ id: 'user-1', pubkey: PUBKEY })

type Handler = (request: Request) => Promise<Response>

async function rpc(
  handler: Handler,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  const res = await handler(
    new Request('http://localhost:3000/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    })
  )
  const text = await res.text()
  return {
    status: res.status,
    headers: res.headers,
    body: text ? JSON.parse(text) : null
  }
}

const oauth = { authorization: 'Bearer lwat_token' }

function grant(scopes: string[], spendLimitSats: number | null = null) {
  vi.mocked(verifyAccessToken).mockResolvedValue({
    grantId: 'grant-1',
    clientId: 'client-1',
    clientName: 'Claude',
    userId: user.id,
    pubkey: PUBKEY,
    scopes: scopes as never,
    spendLimitSats
  })
}

async function toolNames(handler: Handler, headers: Record<string, string>) {
  const { body } = await rpc(handler, 'tools/list', {}, headers)
  return body.result.tools.map((t: { name: string }) => t.name) as string[]
}

async function callTool(
  handler: Handler,
  name: string,
  args: Record<string, unknown>,
  headers: Record<string, string>
) {
  const { status, body } = await rpc(
    handler,
    'tools/call',
    { name, arguments: args },
    headers
  )
  expect(status).toBe(200)
  return {
    isError: body.result.isError as boolean,
    text: body.result.content[0].text as string
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  // The account behind the grant, as resolveRole and the handlers look it up.
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
    ...user,
    lightningAddresses: []
  } as never)
})

describe('POST /api/mcp', () => {
  it('answers 401 with the OAuth challenge when no token is sent', async () => {
    const res = await rpc(mcpPost, 'initialize', {
      protocolVersion: '2025-11-25'
    })
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toBe(
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"'
    )
    expect(res.body.error).toBe('unauthorized')
  })

  it('answers invalid_token for a rejected OAuth token', async () => {
    vi.mocked(verifyAccessToken).mockRejectedValue(
      new AuthenticationError('Invalid access token')
    )
    const res = await rpc(mcpPost, 'tools/list', {}, oauth)
    expect(res.status).toBe(401)
    expect(res.headers.get('WWW-Authenticate')).toMatch(
      /error="invalid_token"$/
    )
    expect(verifyAccessToken).toHaveBeenCalledWith(
      'lwat_token',
      'http://localhost:3000/api/mcp'
    )
  })

  it('initializes an OAuth session', async () => {
    grant(['read', 'write'])
    const { status, body } = await rpc(
      mcpPost,
      'initialize',
      { protocolVersion: '2025-06-18' },
      oauth
    )
    expect(status).toBe(200)
    expect(body.result.protocolVersion).toBe('2025-06-18')
    expect(body.result.serverInfo.name).toBe('lawallet-nwc')
  })

  it('lists tools by scope: spend only for an OAuth spend grant', async () => {
    grant(['read', 'write', 'spend'], 5000)
    const withSpend = await toolNames(mcpPost, oauth)
    expect(withSpend).toContain('wallet_pay_invoice')
    expect(withSpend).toContain('api_write')

    grant(['read'])
    const readOnly = await toolNames(mcpPost, oauth)
    expect(readOnly).not.toContain('api_write')
    expect(readOnly).not.toContain('create_lightning_address')
    expect(readOnly).toContain('wallet_get_balance')
  })

  it('gives an admin with every scope the full, well-formed tool set', async () => {
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      ...user,
      role: 'ADMIN',
      lightningAddresses: []
    } as never)
    grant(['read', 'write', 'spend'], 5000)

    const { body } = await rpc(mcpPost, 'tools/list', {}, oauth)
    const tools = body.result.tools as {
      name: string
      title: string
      description: string
      inputSchema: Record<string, unknown>
      annotations: Record<string, unknown>
    }[]

    expect(tools.map(t => t.name)).toEqual([
      'get_instance_info',
      'resolve_lightning_address',
      'request_address_invoice',
      'verify_address_payment',
      'check_address_availability',
      'get_my_account',
      'list_lightning_addresses',
      'get_lightning_address',
      'list_address_invoices',
      'list_wallets',
      'list_my_cards',
      'list_cards',
      'get_card',
      'list_users',
      'list_activity',
      'get_settings',
      'create_lightning_address',
      'wallet_get_balance',
      'wallet_make_invoice',
      'wallet_lookup_invoice',
      'lightning_address_get_invoice',
      'wallet_pay_invoice',
      'wallet_list_payments',
      'api_list_operations',
      'api_read',
      'api_write'
    ])
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z0-9_]{1,64}$/)
      expect(tool.title, tool.name).toBeTruthy()
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(1000)
      expect(tool.inputSchema.type, tool.name).toBe('object')
      expect(JSON.stringify(tool.inputSchema), tool.name).not.toContain(
        '"$ref"'
      )
      for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) {
        expect(typeof tool.annotations[hint], `${tool.name}.${hint}`).toBe(
          'boolean'
        )
      }
    }
  })

  it('serves a REST read through the real handler with an internal session', async () => {
    grant(['read'])
    vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([
      createRemoteWalletFixture({ userId: user.id, name: 'Main' }),
      createRemoteWalletFixture({
        userId: user.id,
        name: 'Old',
        status: 'REVOKED'
      })
    ] as never)

    const result = await callTool(mcpPost, 'list_wallets', {}, oauth)

    expect(result.isError).toBe(false)
    const wallets = JSON.parse(result.text)
    expect(wallets.map((w: { name: string }) => w.name)).toEqual(['Main'])
    expect(result.text).not.toContain('walletconnect')
    expect(prismaMock.remoteWallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: user.id } })
    )
  })

  it('redacts the NWC connection string GET /api/users/me returns', async () => {
    grant(['read'])
    vi.mocked(getPrimaryRemoteWalletForUser).mockResolvedValue(
      createRemoteWalletFixture({ userId: user.id }) as never
    )
    vi.mocked(decryptRemoteWalletConfig).mockReturnValue({
      connectionString: NWC
    } as never)

    const result = await callTool(mcpPost, 'get_my_account', {}, oauth)

    expect(result.isError).toBe(false)
    expect(JSON.parse(result.text)).toMatchObject({
      userId: user.id,
      nwcString: '[redacted]'
    })
    expect(result.text).not.toContain('walletconnect')
    expect(result.text).not.toContain('c'.repeat(64))
  })

  it('refuses operations above the account role as tool errors', async () => {
    grant(['read'])
    const result = await callTool(
      mcpPost,
      'api_read',
      { operationId: 'cards.list' },
      oauth
    )
    expect(result.isError).toBe(true)
    expect(JSON.parse(result.text).error).toBe(
      'cards.list requires the VIEWER role; this account is USER.'
    )
  })

  it('refuses writes to a read-only grant before dispatching', async () => {
    grant(['read'])
    const result = await callTool(
      mcpPost,
      'api_write',
      { operationId: 'wallet.addresses.create', params: { username: 'bob' } },
      oauth
    )
    expect(result.isError).toBe(true)
    expect(prismaMock.lightningAddress.create).not.toHaveBeenCalled()
  })

  it('treats a session JWT as read + write, never spend', async () => {
    const token = createJwtToken(
      { userId: user.id, pubkey: PUBKEY, role: 'USER' },
      createDefaultConfig().jwt.secret!,
      { expiresIn: 300, issuer: 'lawallet-nwc', audience: 'lawallet-users' }
    )
    const session = { authorization: `Bearer ${token}` }

    const names = await toolNames(mcpPost, session)
    expect(names).toContain('api_write')
    expect(names).not.toContain('wallet_pay_invoice')

    const pay = await callTool(
      mcpPost,
      'wallet_pay_invoice',
      { bolt11: 'lnbc1' },
      session
    )
    expect(pay.isError).toBe(true)
    expect(JSON.parse(pay.text).error).toMatch(/only an OAuth connection/)
    expect(verifyAccessToken).not.toHaveBeenCalled()
  })

  it('speaks the 2026-07-28 revision on the same URL', async () => {
    grant(['read'])
    const { status, body } = await rpc(
      mcpPost,
      'tools/list',
      {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {}
        }
      },
      {
        ...oauth,
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/list'
      }
    )
    expect(status).toBe(200)
    expect(body.result).toMatchObject({
      resultType: 'complete',
      cacheScope: 'private',
      ttlMs: 60000
    })
  })
})

describe('POST /api/mcp/public', () => {
  it('lists public tools only and ignores credentials', async () => {
    const names = await toolNames(publicPost, oauth)
    expect(names).toEqual([
      'get_instance_info',
      'resolve_lightning_address',
      'request_address_invoice',
      'verify_address_payment',
      'check_address_availability',
      'api_list_operations',
      'api_read'
    ])
    expect(verifyAccessToken).not.toHaveBeenCalled()
  })

  it('serves a public REST read anonymously', async () => {
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue(null)
    const result = await callTool(
      publicPost,
      'check_address_availability',
      { username: 'Satoshi' },
      {}
    )
    expect(result).toEqual({
      isError: false,
      text: JSON.stringify({ available: true, username: 'satoshi' })
    })
  })

  it('never answers 401, even for tools that need an account', async () => {
    const res = await rpc(publicPost, 'tools/call', {
      name: 'get_my_account',
      arguments: {}
    })
    expect(res.status).toBe(200)
    expect(res.body.result.isError).toBe(true)
    expect(JSON.parse(res.body.result.content[0].text).error).toMatch(
      /^Sign-in required: connect an MCP client to http:\/\/localhost:3000\/api\/mcp/
    )
  })

  it('answers discovery with public caching', async () => {
    const { status, body } = await rpc(
      publicPost,
      'tools/list',
      {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {}
        }
      },
      { 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' }
    )
    expect(status).toBe(200)
    expect(body.result.cacheScope).toBe('public')
  })
})
