import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createUserFixture } from '@/tests/helpers/fixtures'
import { AuthenticationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn()
}))

vi.mock('@/lib/user', () => ({
  createNewUser: vi.fn()
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))

const reviveDeadCourtesyWallet = vi.hoisted(() =>
  vi.fn<() => Promise<unknown | null>>(async () => null)
)
vi.mock('@/lib/wallet/lncurl-wallet', () => ({
  reviveDeadCourtesyWallet,
  mintCourtesyLncurlWallet: vi.fn(async () => null)
}))

import { GET } from '@/app/api/users/me/route'
import { PUT } from '@/app/api/users/me/currency-prefs/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { createNewUser } from '@/lib/user'
import { getSettings } from '@/lib/settings'
import { mintCourtesyLncurlWallet } from '@/lib/wallet/lncurl-wallet'

const mockPubkey = 'a'.repeat(64)

function mockAuth(pubkey: string = mockPubkey) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER' as any,
    method: 'nip98'
  })
}

function mockAuthReject() {
  vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('no auth'))
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(mintCourtesyLncurlWallet).mockResolvedValue(null)
  reviveDeadCourtesyWallet.mockResolvedValue(null)
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
          mode: 'CUSTOM_NWC',
          redirect: null,
          nwcConnectionId: null,
          nwcConnection: null
        }
      ]
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toMatchObject({
      userId: user.id,
      lightningAddress: 'alice@test.com'
    })
  })

  it('returns saved currency preferences from the user record', async () => {
    mockAuth()
    const currencyPrefs = {
      active: ['SAT', 'BTC', 'USD'],
      selected: 'USD'
    }
    const user = createUserFixture({
      pubkey: mockPubkey,
      currencyPrefs,
      lightningAddresses: [],
      albySubAccount: null
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)
    const body = (await assertResponse(res, 200)) as {
      currencyPrefs: unknown
    }

    expect(body.currencyPrefs).toEqual(currencyPrefs)
  })

  it('omits currency preferences that do not match the schema', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      currencyPrefs: { foo: 1 },
      lightningAddresses: [],
      albySubAccount: null
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body = (await assertResponse(res, 200)) as {
      currencyPrefs: unknown
    }

    expect(body.currencyPrefs).toBeNull()
  })

  it('creates new user if not existing', async () => {
    mockAuth()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)
    const newUser = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: []
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
      lightningAddresses: []
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)
    const body: any = await assertResponse(res, 200)

    expect(body.lightningAddress).toBeNull()
  })

  it('falls back to the request host when no address domain is configured', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'CUSTOM_NWC',
          redirect: null,
          remoteWalletId: null,
          remoteWallet: null
        }
      ]
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({})

    const req = createNextRequest('http://wallet.test/api/users/me')
    const res = await GET(req)
    const body: any = await assertResponse(res, 200)

    expect(body.lightningAddress).toBe('alice@wallet.test')
  })

  it('rejects unauthenticated request', async () => {
    mockAuthReject()

    const req = createNextRequest('/api/users/me')
    const res = await GET(req)

    expect(res.status).toBe(401)
  })

  it('no address: returns the ACTIVE NWC wallet as nwcString', async () => {
    mockAuth()
    const lncurlUri = 'nostr+walletconnect://courtesy-lncurl'
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: []
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })
    // The courtesy wallet createNewUser minted: ACTIVE, bound to nothing.
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue({
      id: 'courtesy-wallet',
      type: 'NWC',
      status: 'ACTIVE',
      isDefault: false,
      updatedAt: new Date('2026-10-18T00:00:00.000Z'),
      config: {
        connectionString: lncurlUri,
        mode: 'SEND_RECEIVE',
        provider: 'lncurl'
      }
    } as any)

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(prismaMock.remoteWallet.findFirst).toHaveBeenCalledWith({
      where: { userId: user.id, status: 'ACTIVE', type: 'NWC' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }]
    })
    // Account resolution (lib/auth/account) issues its own user.findUnique
    // fallback first — assert on the call that carries the include.
    const query = vi
      .mocked(prismaMock.user.findUnique)
      .mock.calls.map(c => c[0])
      .find((arg: any) => arg?.include)
    expect((query as any)?.include).not.toHaveProperty('remoteWallets')
    expect(body).not.toHaveProperty('albySubAccount')
    expect(body.lightningAddress).toBeNull()
    expect(body.nwcString).toBe(lncurlUri)
    expect(body.nwcUpdatedAt).toBe('2026-10-18T00:00:00.000Z')
    // effectiveNwcString stays address-based.
    expect(body.effectiveNwcString).toBeNull()
  })

  it('no address and no ACTIVE wallet: nwcString is empty', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: []
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue(null)

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.nwcString).toBe('')
    expect(body.nwcUpdatedAt).toBeNull()
  })

  it('with a primary address: an unbound ACTIVE wallet is not nwcString', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'IDLE',
          redirect: null,
          remoteWalletId: null,
          remoteWallet: null
        }
      ]
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      mode: 'IDLE',
      remoteWalletId: null,
      remoteWallet: null
    } as any)
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue({
      id: 'unbound-wallet',
      type: 'NWC',
      status: 'ACTIVE',
      updatedAt: new Date(),
      config: { connectionString: 'nostr+walletconnect://unbound' }
    } as any)

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(prismaMock.remoteWallet.findFirst).not.toHaveBeenCalled()
    expect(body.lightningAddress).toBe('alice@test.com')
    expect(body.nwcString).toBe('')
    expect(body.effectiveNwcString).toBeNull()
  })

  // ── primary-address driven fields ───────────────────────────────────────
  // The response grew `effectiveNwcString` + `primaryAddressMode` +
  // `primaryUsername` + `primaryRedirect` so the dashboard can pick the right
  // card without a second round-trip, and NwcCard can scope its balance widget
  // to the address's actual route.

  const primaryConnUri = 'nostr+walletconnect://primary-conn'
  const addressConnUri = 'nostr+walletconnect://address-conn'

  /** Build a RemoteWallet with a given connection string. */
  function defaultWallet(connectionString: string) {
    return {
      type: 'NWC',
      config: { connectionString, mode: 'SEND_RECEIVE' },
      status: 'ACTIVE',
      isDefault: true,
      updatedAt: new Date()
    }
  }

  it('legacy CUSTOM_NWC primary address has no derived primary wallet', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'CUSTOM_NWC',
          redirect: null,
          remoteWalletId: null,
          remoteWallet: null
        }
      ],
      remoteWallets: [defaultWallet(primaryConnUri)]
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.primaryAddressMode).toBe('CUSTOM_NWC')
    expect(body.primaryUsername).toBe('alice')
    expect(body.primaryRedirect).toBeNull()
    expect(body.effectiveNwcString).toBeNull()
  })

  it('CUSTOM_NWC primary with no primary-address wallet: effectiveNwcString is null', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'CUSTOM_NWC',
          redirect: null,
          remoteWalletId: null,
          remoteWallet: null
        }
      ],
      remoteWallets: [] // no default wallet
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.effectiveNwcString).toBeNull()
  })

  it('replaces a dead courtesy wallet before returning the connection string', async () => {
    mockAuth()
    const freshUri = 'nostr+walletconnect://fresh-lncurl'
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'IDLE',
          redirect: null,
          remoteWalletId: null,
          remoteWallet: null
        }
      ]
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })
    reviveDeadCourtesyWallet.mockResolvedValue({
      id: 'fresh-wallet',
      type: 'NWC',
      status: 'ACTIVE',
      isDefault: true,
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      config: {
        connectionString: freshUri,
        mode: 'SEND_RECEIVE',
        provider: 'lncurl'
      }
    })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(reviveDeadCourtesyWallet).toHaveBeenCalledWith(user.id)
    expect(body.primaryAddressMode).toBe('CUSTOM_NWC')
    expect(body.nwcString).toBe(freshUri)
    expect(body.effectiveNwcString).toBe(freshUri)
  })

  it('CUSTOM_NWC primary: effectiveNwcString = the address-bound wallet', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'CUSTOM_NWC',
          redirect: null,
          remoteWalletId: 'wallet-custom',
          // The address's *own* bound wallet — must win over the default.
          remoteWallet: {
            type: 'NWC',
            config: { connectionString: addressConnUri, mode: 'RECEIVE' },
            status: 'ACTIVE'
          }
        }
      ],
      remoteWallets: [defaultWallet(primaryConnUri)]
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.primaryAddressMode).toBe('CUSTOM_NWC')
    expect(body.effectiveNwcString).toBe(addressConnUri)
  })

  it('returns the replacement when the primary LNCurl wallet is DEAD', async () => {
    mockAuth()
    const freshUri = 'nostr+walletconnect://fresh-lncurl'
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'CUSTOM_NWC',
          redirect: null,
          remoteWalletId: 'dead-wallet',
          remoteWallet: {
            id: 'dead-wallet',
            type: 'NWC',
            status: 'DEAD',
            config: {
              connectionString: 'nostr+walletconnect://dead',
              provider: 'lncurl'
            }
          }
        }
      ]
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })
    reviveDeadCourtesyWallet.mockResolvedValue({
      id: 'fresh-wallet',
      type: 'NWC',
      status: 'ACTIVE',
      config: { connectionString: freshUri, provider: 'lncurl' },
      updatedAt: new Date('2026-09-29T00:00:00.000Z')
    })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(reviveDeadCourtesyWallet).toHaveBeenCalledWith(user.id)
    // The dead row is gone from the response: the address now points at the
    // replacement, so neither the raw nor the effective string is the corpse.
    expect(body.primaryAddressMode).toBe('CUSTOM_NWC')
    expect(body.effectiveNwcString).toBe(freshUri)
    expect(body.nwcString).toBe(freshUri)
  })

  it('ALIAS primary: effectiveNwcString is null and redirect is surfaced', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'ALIAS',
          redirect: 'bob@other.com',
          remoteWalletId: null,
          remoteWallet: null
        }
      ],
      remoteWallets: [defaultWallet(primaryConnUri)]
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.primaryAddressMode).toBe('ALIAS')
    expect(body.primaryRedirect).toBe('bob@other.com')
    // ALIAS addresses don't use a wallet even if one is configured — resolver
    // returns `{ kind: 'alias' }` which the route maps to null here.
    expect(body.effectiveNwcString).toBeNull()
  })

  it('IDLE primary: effectiveNwcString is null regardless of available wallets', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [
        {
          username: 'alice',
          isPrimary: true,
          mode: 'IDLE',
          redirect: null,
          remoteWalletId: null,
          remoteWallet: null
        }
      ],
      remoteWallets: [defaultWallet(primaryConnUri)]
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.primaryAddressMode).toBe('IDLE')
    expect(body.effectiveNwcString).toBeNull()
    // IDLE is the holder's choice (or a revoked wallet): loading the account
    // must not mint a wallet behind their back.
    expect(mintCourtesyLncurlWallet).not.toHaveBeenCalled()
  })

  it('promotes the oldest address when the account has no primary', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [],
      remoteWallets: []
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })
    vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
      username: 'stray',
      isPrimary: false,
      mode: 'IDLE',
      redirect: null,
      remoteWalletId: null,
      remoteWallet: null
    } as any)

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith({
      where: { username: 'stray' },
      data: { isPrimary: true }
    })
    expect(body.primaryUsername).toBe('stray')
    expect(body.lightningAddress).toBe('stray@test.com')
  })

  // ── card recovery ───────────────────────────────────────────────────────

  it('returns the card recovery opt-out flag', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [],
      cardRecoveryEnabled: false
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(body.cardRecoveryEnabled).toBe(false)
    expect(body.accountTransfer).toBeNull()
  })

  it('returns the open account-transfer notice with full addresses', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [],
      cardRecoveryEnabled: true
    })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as any)
    vi.mocked(getSettings).mockResolvedValue({ domain: 'test.com' })
    vi.mocked(prismaMock.accountRecovery.findFirst).mockResolvedValue({
      id: 'recovery-1',
      createdAt: new Date('2026-10-20T12:00:00.000Z'),
      summary: {
        lightningAddresses: ['alice', 'alice2'],
        primaryAddress: 'alice',
        cards: [{ id: 'card1', title: 'Blue card', designImageUrl: null }],
        remoteWallets: [
          { id: 'w1', name: 'Main', isDefault: true },
          { id: 'w2', name: 'Spare', isDefault: false }
        ],
        vouchers: 0,
        recoveredWith: { cardId: 'card1', title: 'Blue card' }
      }
    } as any)

    const res = await GET(createNextRequest('/api/users/me'))
    const body: any = await assertResponse(res, 200)

    expect(prismaMock.accountRecovery.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fromUserId: user.id, noticeDismissedAt: null }
      })
    )
    expect(body.cardRecoveryEnabled).toBe(true)
    expect(body.accountTransfer).toEqual({
      id: 'recovery-1',
      transferredAt: '2026-10-20T12:00:00.000Z',
      cardTitle: 'Blue card',
      lightningAddresses: ['alice@test.com', 'alice2@test.com'],
      cards: 1,
      remoteWallets: 2
    })
  })

  it('no primary address: every primary* field is null', async () => {
    mockAuth()
    const user = createUserFixture({
      pubkey: mockPubkey,
      lightningAddresses: [],
      remoteWallets: []
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

describe('PUT /api/users/me/currency-prefs', () => {
  function mockOwner() {
    mockAuth()
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      user: { id: 'user-1', pubkey: mockPubkey, role: 'USER' }
    } as any)
    vi.mocked(prismaMock.user.update).mockResolvedValue({ id: 'user-1' } as any)
  }

  function putPrefs(currencyPrefs: { active: string[]; selected: string }) {
    return PUT(
      createNextRequest('/api/users/me/currency-prefs', {
        method: 'PUT',
        body: { currencyPrefs }
      }) as never
    )
  }

  it('persists currency preferences on the authenticated user', async () => {
    mockOwner()

    const currencyPrefs = {
      active: ['SAT', 'BTC', 'USD'],
      selected: 'USD'
    }
    const res = await putPrefs(currencyPrefs)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ currencyPrefs })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { currencyPrefs }
    })
  })

  it('rejects an active list that drops SAT', async () => {
    mockOwner()

    const res = await putPrefs({ active: ['USD'], selected: 'USD' })

    expect(res.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('rejects a selected currency outside the active list', async () => {
    mockOwner()

    const res = await putPrefs({
      active: ['SAT', 'BTC'],
      selected: 'USD'
    })

    expect(res.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('rejects duplicate active currencies', async () => {
    mockOwner()

    const res = await putPrefs({
      active: ['SAT', 'USD', 'USD'],
      selected: 'USD'
    })

    expect(res.status).toBe(400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })
})
