import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createUserFixture } from '@/tests/helpers/fixtures'
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

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn(),
}))

vi.mock('@/lib/user', () => ({
  createNewUser: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

import { GET } from '@/app/api/users/me/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { createNewUser } from '@/lib/user'
import { getSettings } from '@/lib/settings'

const mockPubkey = 'a'.repeat(64)

function mockAuth(pubkey: string = mockPubkey) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER' as any,
    method: 'nip98',
  })
}

function mockAuthReject() {
  vi.mocked(authenticate).mockRejectedValue(
    new AuthenticationError('no auth')
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/users/me', () => {
  it('returns existing user data', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'DEFAULT_NWC',
          redirect: null,
          nwcConnectionId: null,
          nwcConnection: null,
        },
      ],
      albySubAccount: null,
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toMatchObject({
      userId: user.id,
      lightningAddress: 'alice@test.com',
    })
  })

  it('creates new user if not existing', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
    const newUser = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [],
      albySubAccount: null,
    })
    vi.mocked(createNewUser).mockResolvedValue(newUser as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(createNewUser).toHaveBeenCalledWith(mockPubkey)
    expect(body).toMatchObject({ userId: newUser.id })
  })

  it('returns null lightning address when user has none', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [],
      albySubAccount: null,
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)
    const body: any = await assertResponse(res, 200)

    expect(body.lightningAddress).toBeNull()
  })

  it('rejects unauthenticated request', async () => {
    mockAuthReject()

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('returns alby sub account data when present', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [],
      albySubAccount: {
        appId: 'app123',
        nwcUri: 'nostr+walletconnect://test',
        username: 'alice',
      },
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)
    const body: any = await assertResponse(res, 200)

    expect(body.albySubAccount).toEqual({
      appId: 'app123',
      nwcUri: 'nostr+walletconnect://test',
      username: 'alice',
    })
    expect(body.nwcString).toBe('nostr+walletconnect://test')
  })

  // ── primary-address driven fields ───────────────────────────────────────
  // The response grew `effectiveNwcString` + `primaryAddressMode` +
  // `primaryUsername` + `primaryRedirect` so the dashboard can decide
  // between NwcCard and ForwardingCard without a second round-trip, and
  // NwcCard can scope its balance widget to the address's actual route.

  const primaryConnUri = 'nostr+walletconnect://primary-conn'
  const addressConnUri = 'nostr+walletconnect://address-conn'

  it('DEFAULT_NWC primary address: effectiveNwcString = primary NWCConnection', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      nwc: 'nostr+walletconnect://legacy',
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'DEFAULT_NWC',
          redirect: null,
          nwcConnectionId: null,
          nwcConnection: null,
        },
      ],
      albySubAccount: null,
      nwcConnections: [
        { connectionString: primaryConnUri, isPrimary: true, updatedAt: new Date() },
      ],
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.primaryAddressMode).toBe('DEFAULT_NWC')
    expect(body.primaryUsername).toBe('alice')
    expect(body.primaryRedirect).toBeNull()
    expect(body.effectiveNwcString).toBe(primaryConnUri)
  })

  it('DEFAULT_NWC primary with no NWCConnection falls back to legacy User.nwc', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      nwc: 'nostr+walletconnect://legacy',
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'DEFAULT_NWC',
          redirect: null,
          nwcConnectionId: null,
          nwcConnection: null,
        },
      ],
      albySubAccount: null,
      nwcConnections: [], // migration hasn't happened for this user
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.effectiveNwcString).toBe('nostr+walletconnect://legacy')
  })

  it('CUSTOM_NWC primary: effectiveNwcString = the address-linked connection, not the primary', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      nwc: null,
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'CUSTOM_NWC',
          redirect: null,
          nwcConnectionId: 'conn-custom',
          // The address's *own* link — must win over the user primary.
          nwcConnection: { connectionString: addressConnUri },
        },
      ],
      albySubAccount: null,
      nwcConnections: [
        { connectionString: primaryConnUri, isPrimary: true, updatedAt: new Date() },
      ],
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.primaryAddressMode).toBe('CUSTOM_NWC')
    expect(body.effectiveNwcString).toBe(addressConnUri)
  })

  it('ALIAS primary: effectiveNwcString is null and redirect is surfaced', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      nwc: 'nostr+walletconnect://legacy',
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'ALIAS',
          redirect: 'bob@other.com',
          nwcConnectionId: null,
          nwcConnection: null,
        },
      ],
      albySubAccount: null,
      nwcConnections: [
        { connectionString: primaryConnUri, isPrimary: true, updatedAt: new Date() },
      ],
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.primaryAddressMode).toBe('ALIAS')
    expect(body.primaryRedirect).toBe('bob@other.com')
    // ALIAS addresses don't use NWC even if one is configured — resolver
    // returns `{ kind: 'alias' }` which the route maps to null here.
    expect(body.effectiveNwcString).toBeNull()
  })

  it('IDLE primary: effectiveNwcString is null regardless of available connections', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      nwc: 'nostr+walletconnect://legacy',
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'IDLE',
          redirect: null,
          nwcConnectionId: null,
          nwcConnection: null,
        },
      ],
      albySubAccount: null,
      nwcConnections: [
        { connectionString: primaryConnUri, isPrimary: true, updatedAt: new Date() },
      ],
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.primaryAddressMode).toBe('IDLE')
    expect(body.effectiveNwcString).toBeNull()
  })

  it('no primary address: every primary* field is null', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      nwc: null,
      lightningAddresses: [],
      albySubAccount: null,
      nwcConnections: [],
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.primaryAddressMode).toBeNull()
    expect(body.primaryUsername).toBeNull()
    expect(body.primaryRedirect).toBeNull()
    expect(body.effectiveNwcString).toBeNull()
  })
})
