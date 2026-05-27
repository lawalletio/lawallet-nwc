import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import {
  createRemoteWalletFixture,
  createUserFixture,
} from '@/tests/helpers/fixtures'
import { AuthenticationError } from '@/types/server/errors'

// ── Module mocks ───────────────────────────────────────────────────────────
//
// These mirror the patterns used in cards.test.ts. Config + logger are
// mocked because both call `getConfig()` at module load; the maintenance +
// rate-limit middleware are stubbed to no-ops so we only test the route
// logic, not the full middleware chain.

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1_048_576, maxJsonSize: 1_048_576 },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn,
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

import { GET as listHandler, POST as createHandler } from '@/app/api/remote-wallets/route'
import {
  GET as getHandler,
  PATCH as patchHandler,
  DELETE as deleteHandler,
} from '@/app/api/remote-wallets/[id]/route'
import { authenticate } from '@/lib/auth/unified-auth'

const USER_PUBKEY = 'a'.repeat(64)
const VALID_NWC = `nostr+walletconnect://${'b'.repeat(64)}?relay=wss%3A%2F%2Fr.example&secret=${'c'.repeat(64)}`

function mockAuth(pubkey = USER_PUBKEY) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER' as never,
    method: 'jwt',
  })
}

function mockUnauthenticated() {
  vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('No auth'))
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

// ── GET /api/remote-wallets ────────────────────────────────────────────────

describe('GET /api/remote-wallets', () => {
  it('returns the caller\'s wallets, REVOKED filtered out by default', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)

    const active = createRemoteWalletFixture({ userId: user.id, name: 'Active', status: 'ACTIVE' })
    const disabled = createRemoteWalletFixture({ userId: user.id, name: 'Disabled', status: 'DISABLED' })
    const revoked = createRemoteWalletFixture({ userId: user.id, name: 'Revoked', status: 'REVOKED' })
    vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([active, disabled, revoked] as never)

    const res = await listHandler(createNextRequest('/api/remote-wallets'))
    const body = (await assertResponse(res, 200)) as Array<{ name: string }>

    expect(body.map(w => w.name)).toEqual(['Active', 'Disabled'])
  })

  it('returns REVOKED wallets when explicitly requested via ?status=REVOKED', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const revoked = createRemoteWalletFixture({ userId: user.id, name: 'X', status: 'REVOKED' })
    vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([revoked] as never)

    const res = await listHandler(createNextRequest('/api/remote-wallets', { searchParams: { status: 'REVOKED' } }))
    const body = (await assertResponse(res, 200)) as Array<{ name: string; status: string }>

    expect(body).toHaveLength(1)
    expect(body[0].status).toBe('REVOKED')
  })

  it('passes type filter through to the Prisma query', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([] as never)

    await listHandler(createNextRequest('/api/remote-wallets', { searchParams: { type: 'NWC' } }))

    expect(prismaMock.remoteWallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: user.id, type: 'NWC' }) }),
    )
  })

  it('orders default-first then createdAt desc', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([] as never)

    await listHandler(createNextRequest('/api/remote-wallets'))

    expect(prismaMock.remoteWallet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] }),
    )
  })

  it('does NOT leak the config field in the response', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const w = createRemoteWalletFixture({ userId: user.id, config: { connectionString: VALID_NWC, mode: 'RECEIVE' } })
    vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([w] as never)

    const res = await listHandler(createNextRequest('/api/remote-wallets'))
    const body = (await assertResponse(res, 200)) as Array<Record<string, unknown>>

    expect(body[0]).not.toHaveProperty('config')
    expect(body[0]).not.toHaveProperty('userId')
  })

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated()
    const res = await listHandler(createNextRequest('/api/remote-wallets'))
    expect(res.status).toBe(401)
  })
})

// ── POST /api/remote-wallets ───────────────────────────────────────────────

describe('POST /api/remote-wallets', () => {
  it('creates a wallet with valid NWC config', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const created = createRemoteWalletFixture({ userId: user.id, name: 'My Wallet' })
    vi.mocked(prismaMock.remoteWallet.create).mockResolvedValue(created as never)

    const res = await createHandler(
      createNextRequest('/api/remote-wallets', {
        method: 'POST',
        body: { name: 'My Wallet', type: 'NWC', config: { connectionString: VALID_NWC } },
      }),
    )
    const body = (await assertResponse(res, 201)) as { name: string; type: string }

    expect(body.name).toBe('My Wallet')
    expect(body.type).toBe('NWC')
  })

  it('persists the parsed config with mode defaulted to RECEIVE', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(prismaMock.remoteWallet.create).mockResolvedValue(
      createRemoteWalletFixture({ userId: user.id }) as never,
    )

    await createHandler(
      createNextRequest('/api/remote-wallets', {
        method: 'POST',
        body: { name: 'X', type: 'NWC', config: { connectionString: VALID_NWC } },
      }),
    )

    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          config: expect.objectContaining({ connectionString: VALID_NWC, mode: 'RECEIVE' }),
        }),
      }),
    )
  })

  it('rejects a config that fails the driver schema', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)

    const res = await createHandler(
      createNextRequest('/api/remote-wallets', {
        method: 'POST',
        body: { name: 'X', type: 'NWC', config: { connectionString: 'https://not-nwc' } },
      }),
    )

    expect(res.status).toBe(400)
    expect(prismaMock.remoteWallet.create).not.toHaveBeenCalled()
  })

  it('rejects an empty name', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)

    const res = await createHandler(
      createNextRequest('/api/remote-wallets', {
        method: 'POST',
        body: { name: '   ', type: 'NWC', config: { connectionString: VALID_NWC } },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 409 when the (userId, name) unique index fires', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const conflict = Object.assign(new Error('unique violation'), { code: 'P2002' })
    vi.mocked(prismaMock.remoteWallet.create).mockRejectedValue(conflict)

    const res = await createHandler(
      createNextRequest('/api/remote-wallets', {
        method: 'POST',
        body: { name: 'Duplicate', type: 'NWC', config: { connectionString: VALID_NWC } },
      }),
    )
    expect(res.status).toBe(409)
  })

  it('rethrows non-P2002 DB errors as a 500', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    // A generic DB failure (no P2002 code) must not be swallowed as a 409.
    vi.mocked(prismaMock.remoteWallet.create).mockRejectedValue(new Error('connection reset'))

    const res = await createHandler(
      createNextRequest('/api/remote-wallets', {
        method: 'POST',
        body: { name: 'X', type: 'NWC', config: { connectionString: VALID_NWC } },
      }),
    )
    expect(res.status).toBe(500)
  })

  it('clears the previous default when creating a new wallet with isDefault=true', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    // A primary already exists, so the explicit isDefault must demote it.
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue({ id: 'old-default' } as never)
    vi.mocked(prismaMock.remoteWallet.create).mockResolvedValue(
      createRemoteWalletFixture({ userId: user.id, isDefault: true }) as never,
    )

    await createHandler(
      createNextRequest('/api/remote-wallets', {
        method: 'POST',
        body: { name: 'Default', type: 'NWC', config: { connectionString: VALID_NWC }, isDefault: true },
      }),
    )

    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, isDefault: true },
      data: { isDefault: false },
    })
  })

  it('makes the FIRST wallet primary automatically (no existing default)', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    // No primary yet.
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue(null as never)
    vi.mocked(prismaMock.remoteWallet.create).mockResolvedValue(
      createRemoteWalletFixture({ userId: user.id, isDefault: true }) as never,
    )

    await createHandler(
      createNextRequest('/api/remote-wallets', {
        method: 'POST',
        // Note: isDefault NOT requested.
        body: { name: 'First', type: 'NWC', config: { connectionString: VALID_NWC } },
      }),
    )

    // Created as primary even though the client didn't ask…
    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) }),
    )
    // …and nothing to demote, so no updateMany.
    expect(prismaMock.remoteWallet.updateMany).not.toHaveBeenCalled()
  })

  it('does NOT make a subsequent wallet primary by default (a primary already exists)', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    // A primary already exists.
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue({ id: 'existing-default' } as never)
    vi.mocked(prismaMock.remoteWallet.create).mockResolvedValue(
      createRemoteWalletFixture({ userId: user.id, isDefault: false }) as never,
    )

    await createHandler(
      createNextRequest('/api/remote-wallets', {
        method: 'POST',
        body: { name: 'Second', type: 'NWC', config: { connectionString: VALID_NWC } },
      }),
    )

    expect(prismaMock.remoteWallet.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDefault: false }) }),
    )
    // Existing primary stays untouched.
    expect(prismaMock.remoteWallet.updateMany).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    mockUnauthenticated()
    const res = await createHandler(
      createNextRequest('/api/remote-wallets', {
        method: 'POST',
        body: { name: 'X', type: 'NWC', config: { connectionString: VALID_NWC } },
      }),
    )
    expect(res.status).toBe(401)
  })
})

// ── GET /api/remote-wallets/[id] ───────────────────────────────────────────

describe('GET /api/remote-wallets/[id]', () => {
  it('returns the wallet when owned by the caller', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const wallet = createRemoteWalletFixture({ id: 'w1', userId: user.id, name: 'Mine' })
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as never)

    const res = await getHandler(
      createNextRequest('/api/remote-wallets/w1'),
      createParamsPromise({ id: 'w1' }),
    )
    const body = (await assertResponse(res, 200)) as { name: string }
    expect(body.name).toBe('Mine')
  })

  it('returns 404 (not 403) when the wallet belongs to another user', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const wallet = createRemoteWalletFixture({ id: 'w1', userId: 'other-user' })
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as never)

    const res = await getHandler(
      createNextRequest('/api/remote-wallets/w1'),
      createParamsPromise({ id: 'w1' }),
    )
    expect(res.status).toBe(404)
  })

  it('returns 404 when the wallet does not exist', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(null as never)

    const res = await getHandler(
      createNextRequest('/api/remote-wallets/missing'),
      createParamsPromise({ id: 'missing' }),
    )
    expect(res.status).toBe(404)
  })
})

// ── PATCH /api/remote-wallets/[id] ─────────────────────────────────────────

describe('PATCH /api/remote-wallets/[id]', () => {
  it('renames the wallet', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const wallet = createRemoteWalletFixture({ id: 'w1', userId: user.id })
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as never)
    vi.mocked(prismaMock.remoteWallet.update).mockResolvedValue({ ...wallet, name: 'Renamed' } as never)

    const res = await patchHandler(
      createNextRequest('/api/remote-wallets/w1', { method: 'PATCH', body: { name: 'Renamed' } }),
      createParamsPromise({ id: 'w1' }),
    )
    const body = (await assertResponse(res, 200)) as { name: string }
    expect(body.name).toBe('Renamed')
  })

  it('flipping isDefault=true clears the previous default first', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const wallet = createRemoteWalletFixture({ id: 'w1', userId: user.id })
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as never)
    vi.mocked(prismaMock.remoteWallet.update).mockResolvedValue({ ...wallet, isDefault: true } as never)

    await patchHandler(
      createNextRequest('/api/remote-wallets/w1', { method: 'PATCH', body: { isDefault: true } }),
      createParamsPromise({ id: 'w1' }),
    )

    expect(prismaMock.remoteWallet.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, isDefault: true, NOT: { id: 'w1' } },
      data: { isDefault: false },
    })
  })

  it('changes status to DISABLED', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const wallet = createRemoteWalletFixture({ id: 'w1', userId: user.id })
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as never)
    vi.mocked(prismaMock.remoteWallet.update).mockResolvedValue({ ...wallet, status: 'DISABLED' } as never)

    const res = await patchHandler(
      createNextRequest('/api/remote-wallets/w1', { method: 'PATCH', body: { status: 'DISABLED' } }),
      createParamsPromise({ id: 'w1' }),
    )
    const body = (await assertResponse(res, 200)) as { status: string }
    expect(body.status).toBe('DISABLED')
  })

  it('rejects an empty body', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const wallet = createRemoteWalletFixture({ id: 'w1', userId: user.id })
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as never)

    const res = await patchHandler(
      createNextRequest('/api/remote-wallets/w1', { method: 'PATCH', body: {} }),
      createParamsPromise({ id: 'w1' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when the wallet belongs to another user', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const wallet = createRemoteWalletFixture({ id: 'w1', userId: 'other-user' })
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as never)

    const res = await patchHandler(
      createNextRequest('/api/remote-wallets/w1', { method: 'PATCH', body: { name: 'Hijack' } }),
      createParamsPromise({ id: 'w1' }),
    )
    expect(res.status).toBe(404)
    expect(prismaMock.remoteWallet.update).not.toHaveBeenCalled()
  })

  it('returns 409 on a name collision', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const wallet = createRemoteWalletFixture({ id: 'w1', userId: user.id })
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as never)
    const conflict = Object.assign(new Error('unique violation'), { code: 'P2002' })
    vi.mocked(prismaMock.remoteWallet.update).mockRejectedValue(conflict)

    const res = await patchHandler(
      createNextRequest('/api/remote-wallets/w1', { method: 'PATCH', body: { name: 'Taken' } }),
      createParamsPromise({ id: 'w1' }),
    )
    expect(res.status).toBe(409)
  })

  it('rethrows non-P2002 DB errors as a 500', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const wallet = createRemoteWalletFixture({ id: 'w1', userId: user.id })
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as never)
    vi.mocked(prismaMock.remoteWallet.update).mockRejectedValue(new Error('connection reset'))

    const res = await patchHandler(
      createNextRequest('/api/remote-wallets/w1', { method: 'PATCH', body: { name: 'New' } }),
      createParamsPromise({ id: 'w1' }),
    )
    expect(res.status).toBe(500)
  })
})

// ── DELETE /api/remote-wallets/[id] ────────────────────────────────────────

describe('DELETE /api/remote-wallets/[id]', () => {
  it('soft-deletes by setting status to REVOKED and clearing isDefault', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const wallet = createRemoteWalletFixture({ id: 'w1', userId: user.id, isDefault: true })
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as never)
    vi.mocked(prismaMock.remoteWallet.update).mockResolvedValue({
      ...wallet,
      status: 'REVOKED',
      isDefault: false,
    } as never)

    const res = await deleteHandler(
      createNextRequest('/api/remote-wallets/w1', { method: 'DELETE' }),
      createParamsPromise({ id: 'w1' }),
    )
    expect(res.status).toBe(204)
    expect(prismaMock.remoteWallet.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { status: 'REVOKED', isDefault: false },
    })
  })

  it('returns 404 when the wallet belongs to another user', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    const wallet = createRemoteWalletFixture({ id: 'w1', userId: 'other-user' })
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(wallet as never)

    const res = await deleteHandler(
      createNextRequest('/api/remote-wallets/w1', { method: 'DELETE' }),
      createParamsPromise({ id: 'w1' }),
    )
    expect(res.status).toBe(404)
    expect(prismaMock.remoteWallet.update).not.toHaveBeenCalled()
  })
})
