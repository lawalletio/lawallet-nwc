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

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({})),
}))

import { GET as ListGet, POST as ListPost } from '@/app/api/wallet/addresses/route'
import {
  GET as DetailGet,
  PUT as DetailPut,
} from '@/app/api/wallet/addresses/[username]/route'
import { POST as PrimaryPost } from '@/app/api/wallet/addresses/[username]/primary/route'
import { GET as InvoicesGet } from '@/app/api/wallet/addresses/[username]/invoices/route'
import { POST as NwcConnectionsPost } from '@/app/api/wallet/nwc-connections/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { eventBus } from '@/lib/events/event-bus'

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

  it('rejects with 402 when paid registration is on and caller is USER', async () => {
    const { getSettings } = await import('@/lib/settings')
    vi.mocked(getSettings).mockResolvedValueOnce({
      registration_ln_enabled: 'true',
      registration_ln_address: 'admin@provider.com',
      registration_admin_bypass: 'true',
    })
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)

    const res = await ListPost(
      createNextRequest('/api/wallet/addresses', {
        method: 'POST',
        body: { username: 'bob' },
      })
    )

    expect(res.status).toBe(402)
    expect(prismaMock.lightningAddress.create).not.toHaveBeenCalled()
  })

  it('lets ADMIN bypass payment when admin bypass toggle is on', async () => {
    const { getSettings } = await import('@/lib/settings')
    vi.mocked(getSettings).mockResolvedValueOnce({
      registration_ln_enabled: 'true',
      registration_ln_address: 'admin@provider.com',
      registration_admin_bypass: 'true',
    })
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: mockPubkey,
      role: 'ADMIN' as any,
      method: 'jwt',
    })
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

    expect(res.status).toBe(201)
    expect(prismaMock.lightningAddress.create).toHaveBeenCalled()
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

// ── GET /api/wallet/addresses/[username]/invoices ───────────────────────────

describe('GET /api/wallet/addresses/[username]/invoices', () => {
  function makeInvoice(overrides: Partial<any> = {}) {
    return {
      id: 'inv-1',
      amountSats: 1000,
      description: 'Payment to @alice',
      status: 'PENDING',
      metadata: { username: 'alice' },
      paymentHash: 'c'.repeat(64),
      createdAt: new Date('2026-02-01T00:00:00Z'),
      paidAt: null,
      expiresAt: new Date('2026-02-01T01:00:00Z'),
      ...overrides,
    }
  }

  it('returns the caller-owned address invoices, newest first', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      userId: 'user-1',
    } as any)
    vi.mocked(prismaMock.invoice.findMany).mockResolvedValue([
      makeInvoice({ id: 'inv-paid', status: 'PAID', paidAt: new Date('2026-02-05') }),
      makeInvoice({ id: 'inv-pending', metadata: { username: 'alice', comment: 'thanks' } }),
    ] as any)

    const res = await InvoicesGet(
      createNextRequest('/api/wallet/addresses/alice/invoices'),
      createParamsPromise({ username: 'alice' }),
    )
    const body: any = await assertResponse(res, 200)

    expect(body.invoices).toHaveLength(2)
    expect(body.invoices[0].id).toBe('inv-paid')
    expect(body.invoices[1].comment).toBe('thanks')
    // Confirm the Postgres-side scoping is applied — userId + purpose +
    // JSON-path filter on metadata.username — so users can't read another
    // address's invoices by swapping the URL segment.
    expect(prismaMock.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          purpose: 'LUD16_PAYMENT',
          metadata: { path: ['username'], equals: 'alice' },
        },
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
        take: 20,
      }),
    )
  })

  it('returns an empty list when the address has no invoices yet', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      userId: 'user-1',
    } as any)
    vi.mocked(prismaMock.invoice.findMany).mockResolvedValue([])

    const res = await InvoicesGet(
      createNextRequest('/api/wallet/addresses/alice/invoices'),
      createParamsPromise({ username: 'alice' }),
    )
    const body: any = await assertResponse(res, 200)
    expect(body).toEqual({ invoices: [] })
  })

  it('404s when the address is owned by another user', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      // Address belongs to a different user — same opaque 404 as the
      // detail route so we don't leak address existence.
      userId: 'user-2',
    } as any)

    const res = await InvoicesGet(
      createNextRequest('/api/wallet/addresses/alice/invoices'),
      createParamsPromise({ username: 'alice' }),
    )
    expect(res.status).toBe(404)
    expect(prismaMock.invoice.findMany).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated callers', async () => {
    mockAuthReject()
    const res = await InvoicesGet(
      createNextRequest('/api/wallet/addresses/alice/invoices'),
      createParamsPromise({ username: 'alice' }),
    )
    expect(res.status).toBe(401)
  })
})

// ── POST /api/wallet/nwc-connections ────────────────────────────────────────

describe('POST /api/wallet/nwc-connections', () => {
  const validUri =
    'nostr+walletconnect://abcdef0123456789?relay=wss%3A%2F%2Frelay.example&secret=deadbeef'

  it('creates a new connection for the caller', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.nWCConnection.findFirst).mockResolvedValue(null)
    // `$transaction(cb)` hands our callback a pseudo-tx; the real route
    // only uses it for the isPrimary-flip + create in one atomic step.
    // Short-circuit with a direct create path for the test.
    vi.mocked(prismaMock.$transaction).mockImplementation(async (cb: any) =>
      cb(prismaMock),
    )
    vi.mocked(prismaMock.nWCConnection.create).mockResolvedValue({
      id: 'conn-new',
      userId: 'user-1',
      connectionString: validUri,
      mode: 'RECEIVE',
      isPrimary: false,
      createdAt: new Date('2026-02-10'),
      updatedAt: new Date('2026-02-10'),
    } as any)

    const res = await NwcConnectionsPost(
      createNextRequest('/api/wallet/nwc-connections', {
        method: 'POST',
        body: { connectionString: validUri },
      }),
    )
    const body: any = await assertResponse(res, 201)

    expect(body).toMatchObject({
      id: 'conn-new',
      mode: 'RECEIVE',
      isPrimary: false,
    })
    // Bus event is emitted so the address list (whose derived `nwcMode`
    // depends on the primary connection) revalidates.
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'addresses:updated' }),
    )
  })

  it('is idempotent — same (userId, connectionString) returns the existing row with 200', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(prismaMock.nWCConnection.findFirst).mockResolvedValue({
      id: 'conn-existing',
      userId: 'user-1',
      connectionString: validUri,
      mode: 'RECEIVE',
      isPrimary: true,
      createdAt: new Date('2026-02-01'),
      updatedAt: new Date('2026-02-01'),
    } as any)

    const res = await NwcConnectionsPost(
      createNextRequest('/api/wallet/nwc-connections', {
        method: 'POST',
        body: { connectionString: validUri },
      }),
    )
    const body: any = await assertResponse(res, 200)

    expect(body.id).toBe('conn-existing')
    // No write should happen — retries after a flaky network don't
    // fabricate duplicate rows.
    expect(prismaMock.nWCConnection.create).not.toHaveBeenCalled()
  })

  it('rejects payloads that parseNwc cannot interpret', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'user-1' } as any)

    const res = await NwcConnectionsPost(
      createNextRequest('/api/wallet/nwc-connections', {
        method: 'POST',
        // Correct prefix but missing pubkey + relays → parseNwc returns
        // with empty relays → route returns 409 via ConflictError.
        body: { connectionString: 'nostr+walletconnect://' },
      }),
    )
    expect(res.status).toBe(409)
  })

  it('rejects bodies that don\u2019t pass the Zod regex', async () => {
    mockAuth()

    const res = await NwcConnectionsPost(
      createNextRequest('/api/wallet/nwc-connections', {
        method: 'POST',
        body: { connectionString: 'https://not-an-nwc-uri' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('rejects unauthenticated callers', async () => {
    mockAuthReject()
    const res = await NwcConnectionsPost(
      createNextRequest('/api/wallet/nwc-connections', {
        method: 'POST',
        body: { connectionString: validUri },
      }),
    )
    expect(res.status).toBe(401)
  })
})
