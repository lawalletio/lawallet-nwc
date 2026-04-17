import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { AuthenticationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn(),
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}))

import { GET as ListGet, POST as ListPost } from '@/app/api/wallet/addresses/route'
import {
  GET as DetailGet,
  PUT as DetailPut,
} from '@/app/api/wallet/addresses/[username]/route'
import { POST as PrimaryPost } from '@/app/api/wallet/addresses/[username]/primary/route'
import { authenticate } from '@/lib/auth/unified-auth'

const mockPubkey = 'a'.repeat(64)
const otherPubkey = 'b'.repeat(64)

function mockAuth(pubkey = mockPubkey) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER' as any,
    method: 'jwt',
  })
}

function mockAuthReject() {
  vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('no auth'))
}

function makeAddress(overrides: Partial<any> = {}) {
  return {
    username: 'alice',
    userId: 'user-1',
    mode: 'DEFAULT_NWC',
    redirect: null,
    nwcConnectionId: null,
    isPrimary: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    nwcConnection: null,
    ...overrides,
  }
}

function makeConnection(overrides: Partial<any> = {}) {
  return {
    id: 'conn-1',
    userId: 'user-1',
    connectionString: 'nostr+walletconnect://abc',
    mode: 'RECEIVE',
    isPrimary: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

// ── GET /api/wallet/addresses ────────────────────────────────────────────────

describe('GET /api/wallet/addresses', () => {
  it('rejects unauthenticated requests', async () => {
    mockAuthReject()
    const res = await ListGet(createNextRequest('/api/wallet/addresses'))
    expect(res.status).toBe(401)
  })

  it('returns the caller\u2019s addresses with derived nwcMode for each', async () => {
    mockAuth()
    const primaryConn = makeConnection({ id: 'conn-primary', mode: 'SEND_RECEIVE' })
    const customConn = makeConnection({ id: 'conn-custom', mode: 'RECEIVE', isPrimary: false })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-1',
      lightningAddresses: [
        // DEFAULT_NWC -> inherits primary connection's mode (SEND_RECEIVE)
        makeAddress({ username: 'alice', isPrimary: true, mode: 'DEFAULT_NWC' }),
        // CUSTOM_NWC -> uses linked connection's mode (RECEIVE)
        makeAddress({
          username: 'bob',
          isPrimary: false,
          mode: 'CUSTOM_NWC',
          nwcConnectionId: 'conn-custom',
          nwcConnection: customConn,
        }),
        // ALIAS -> NONE regardless of connections
        makeAddress({
          username: 'carol',
          isPrimary: false,
          mode: 'ALIAS',
          redirect: 'someone@elsewhere.com',
        }),
        // IDLE -> NONE
        makeAddress({ username: 'dave', isPrimary: false, mode: 'IDLE' }),
      ],
      nwcConnections: [primaryConn],
    } as any)

    const res = await ListGet(createNextRequest('/api/wallet/addresses'))
    const body: any = await assertResponse(res, 200)
    expect(body).toHaveLength(4)
    expect(body[0]).toMatchObject({ username: 'alice', isPrimary: true, nwcMode: 'SEND_RECEIVE' })
    expect(body[1]).toMatchObject({ username: 'bob', nwcMode: 'RECEIVE' })
    expect(body[2]).toMatchObject({ username: 'carol', mode: 'ALIAS', redirect: 'someone@elsewhere.com', nwcMode: 'NONE' })
    expect(body[3]).toMatchObject({ username: 'dave', mode: 'IDLE', nwcMode: 'NONE' })
  })

  it('falls back to NONE when DEFAULT_NWC user has no primary connection', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-1',
      lightningAddresses: [makeAddress({ mode: 'DEFAULT_NWC' })],
      nwcConnections: [], // no primary
    } as any)

    const res = await ListGet(createNextRequest('/api/wallet/addresses'))
    const body: any = await assertResponse(res, 200)
    expect(body[0].nwcMode).toBe('NONE')
  })
})

// ── POST /api/wallet/addresses ───────────────────────────────────────────────

describe('POST /api/wallet/addresses', () => {
  it('rejects an invalid username format', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)

    const res = await ListPost(
      createNextRequest('/api/wallet/addresses', {
        method: 'POST',
        body: { username: 'WITH-CAPS' },
      })
    )
    expect(res.status).toBe(400)
  })

  it('rejects usernames longer than 16 chars', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)

    const res = await ListPost(
      createNextRequest('/api/wallet/addresses', {
        method: 'POST',
        body: { username: 'a'.repeat(17) },
      })
    )
    expect(res.status).toBe(400)
  })

  it('returns 409 when username is taken', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
    } as any)

    const res = await ListPost(
      createNextRequest('/api/wallet/addresses', {
        method: 'POST',
        body: { username: 'alice' },
      })
    )
    expect(res.status).toBe(409)
  })

  it('creates a new address as non-primary by default', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.lightningAddress.create).mockResolvedValue(
      makeAddress({ username: 'bob', isPrimary: false }) as any,
    )
    vi.mocked(prismaMock.nWCConnection.findFirst).mockResolvedValue(null)

    const res = await ListPost(
      createNextRequest('/api/wallet/addresses', {
        method: 'POST',
        body: { username: 'bob' },
      })
    )
    const body: any = await assertResponse(res, 201)
    expect(body.username).toBe('bob')
    expect(body.isPrimary).toBe(false)
    expect(prismaMock.lightningAddress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          username: 'bob',
          userId: 'user-1',
          mode: 'DEFAULT_NWC',
          isPrimary: false,
        }),
      }),
    )
  })
})

// ── GET /api/wallet/addresses/[username] ────────────────────────────────────

describe('GET /api/wallet/addresses/[username]', () => {
  it('returns the address plus the user\u2019s connections', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(makeAddress() as any)
    vi.mocked(prismaMock.nWCConnection.findMany).mockResolvedValue([
      makeConnection(),
      makeConnection({ id: 'conn-2', mode: 'SEND_RECEIVE', isPrimary: false }),
    ] as any)

    const res = await DetailGet(
      createNextRequest('/api/wallet/addresses/alice'),
      createParamsPromise({ username: 'alice' }),
    )
    const body: any = await assertResponse(res, 200)
    expect(body.address.username).toBe('alice')
    expect(body.connections).toHaveLength(2)
    expect(body.connections[0]).toMatchObject({ id: 'conn-1', mode: 'RECEIVE', isPrimary: true })
  })

  it('returns 404 when the address belongs to a different user', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(
      makeAddress({ userId: 'someone-else' }) as any,
    )

    const res = await DetailGet(
      createNextRequest('/api/wallet/addresses/alice'),
      createParamsPromise({ username: 'alice' }),
    )
    expect(res.status).toBe(404)
  })
})

// ── PUT /api/wallet/addresses/[username] ────────────────────────────────────

describe('PUT /api/wallet/addresses/[username]', () => {
  beforeEach(() => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(makeAddress() as any)
    ;(prismaMock.lightningAddress.update as any).mockImplementation(
      async ({ data }: any) =>
        makeAddress({ ...data, username: 'alice', userId: 'user-1' }),
    )
    vi.mocked(prismaMock.nWCConnection.findFirst).mockResolvedValue(null)
  })

  it('switches mode to ALIAS with redirect', async () => {
    const res = await DetailPut(
      createNextRequest('/api/wallet/addresses/alice', {
        method: 'PUT',
        body: { mode: 'ALIAS', redirect: 'someone@example.com' },
      }),
      createParamsPromise({ username: 'alice' }),
    )
    const body: any = await assertResponse(res, 200)
    expect(body.mode).toBe('ALIAS')
    expect(body.redirect).toBe('someone@example.com')
  })

  it('rejects ALIAS without redirect', async () => {
    const res = await DetailPut(
      createNextRequest('/api/wallet/addresses/alice', {
        method: 'PUT',
        body: { mode: 'ALIAS' },
      }),
      createParamsPromise({ username: 'alice' }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects ALIAS with malformed redirect', async () => {
    const res = await DetailPut(
      createNextRequest('/api/wallet/addresses/alice', {
        method: 'PUT',
        body: { mode: 'ALIAS', redirect: 'not-a-lightning-address' },
      }),
      createParamsPromise({ username: 'alice' }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects CUSTOM_NWC without nwcConnectionId', async () => {
    const res = await DetailPut(
      createNextRequest('/api/wallet/addresses/alice', {
        method: 'PUT',
        body: { mode: 'CUSTOM_NWC' },
      }),
      createParamsPromise({ username: 'alice' }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects CUSTOM_NWC referencing another user\u2019s connection', async () => {
    vi.mocked(prismaMock.nWCConnection.findUnique).mockResolvedValue(
      makeConnection({ userId: 'someone-else' }) as any,
    )
    const res = await DetailPut(
      createNextRequest('/api/wallet/addresses/alice', {
        method: 'PUT',
        body: { mode: 'CUSTOM_NWC', nwcConnectionId: 'conn-1' },
      }),
      createParamsPromise({ username: 'alice' }),
    )
    expect(res.status).toBe(400)
  })

  it('accepts CUSTOM_NWC with a valid owned connection', async () => {
    vi.mocked(prismaMock.nWCConnection.findUnique).mockResolvedValue(
      makeConnection({ id: 'conn-1', userId: 'user-1' }) as any,
    )
    const res = await DetailPut(
      createNextRequest('/api/wallet/addresses/alice', {
        method: 'PUT',
        body: { mode: 'CUSTOM_NWC', nwcConnectionId: 'conn-1' },
      }),
      createParamsPromise({ username: 'alice' }),
    )
    const body: any = await assertResponse(res, 200)
    expect(body.mode).toBe('CUSTOM_NWC')
    expect(body.nwcConnectionId).toBe('conn-1')
  })

  it('clears redirect + nwcConnectionId when switching to IDLE/DEFAULT_NWC', async () => {
    await DetailPut(
      createNextRequest('/api/wallet/addresses/alice', {
        method: 'PUT',
        body: { mode: 'IDLE', redirect: 'ignored@x.com', nwcConnectionId: 'conn-1' },
      }),
      createParamsPromise({ username: 'alice' }),
    )
    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { mode: 'IDLE', redirect: null, nwcConnectionId: null },
      }),
    )
  })

  it('returns 404 when address is not owned by caller', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(
      makeAddress({ userId: 'someone-else' }) as any,
    )
    const res = await DetailPut(
      createNextRequest('/api/wallet/addresses/alice', {
        method: 'PUT',
        body: { mode: 'IDLE' },
      }),
      createParamsPromise({ username: 'alice' }),
    )
    expect(res.status).toBe(404)
  })
})

// ── POST /api/wallet/addresses/[username]/primary ───────────────────────────

describe('POST /api/wallet/addresses/[username]/primary', () => {
  it('clears existing primary then promotes the target atomically', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(
      makeAddress({ username: 'bob', isPrimary: false }) as any,
    )

    const res = await PrimaryPost(
      createNextRequest('/api/wallet/addresses/bob/primary', { method: 'POST' }),
      createParamsPromise({ username: 'bob' }),
    )
    const body: any = await assertResponse(res, 200)
    expect(body).toEqual({ success: true, username: 'bob' })

    // The transaction is two steps in order: clear all then promote one.
    expect(prismaMock.$transaction).toHaveBeenCalled()
    expect(prismaMock.lightningAddress.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', isPrimary: true },
        data: { isPrimary: false },
      }),
    )
    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { username: 'bob' },
        data: { isPrimary: true },
      }),
    )
  })

  it('returns 404 when address is not owned by caller', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(
      makeAddress({ userId: otherPubkey }) as any,
    )

    const res = await PrimaryPost(
      createNextRequest('/api/wallet/addresses/alice/primary', { method: 'POST' }),
      createParamsPromise({ username: 'alice' }),
    )
    expect(res.status).toBe(404)
  })

  it('rejects unauthenticated requests', async () => {
    mockAuthReject()
    const res = await PrimaryPost(
      createNextRequest('/api/wallet/addresses/alice/primary', { method: 'POST' }),
      createParamsPromise({ username: 'alice' }),
    )
    expect(res.status).toBe(401)
  })
})
