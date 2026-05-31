import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createRemoteWalletFixture, createUserFixture } from '@/tests/helpers/fixtures'
import { AuthenticationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))

vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))

// The balance route reads through the driver → NWC driver →
// getServerNwcClient → @getalby/sdk NWCClient.getBalance. Mock it so we
// never hit a relay; getBalance returns msats.
const getBalanceMock = vi.fn()
vi.mock('@getalby/sdk', () => ({
  NWCClient: vi.fn().mockImplementation(() => ({
    getBalance: getBalanceMock,
    close: vi.fn(),
  })),
}))

import { GET as balanceHandler } from '@/app/api/remote-wallets/[id]/balance/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { closeAllServerNwcClients } from '@/lib/wallet/drivers/nwc-client-cache'

const USER_PUBKEY = 'a'.repeat(64)

function mockAuth(pubkey = USER_PUBKEY) {
  vi.mocked(authenticate).mockResolvedValue({ pubkey, role: 'USER' as never, method: 'jwt' })
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  closeAllServerNwcClients()
})

describe('GET /api/remote-wallets/[id]/balance', () => {
  it('returns the balance (sats) for an owned ACTIVE wallet', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      createRemoteWalletFixture({ id: 'w1', userId: user.id, status: 'ACTIVE' }) as never,
    )
    getBalanceMock.mockResolvedValueOnce({ balance: 12_345_000 }) // msats

    const res = await balanceHandler(
      createNextRequest('/api/remote-wallets/w1/balance'),
      createParamsPromise({ id: 'w1' }),
    )
    const body = (await assertResponse(res, 200)) as { balanceSats: number }
    expect(body.balanceSats).toBe(12_345)
  })

  it('returns 404 when the wallet belongs to another user', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      createRemoteWalletFixture({ id: 'w1', userId: 'someone-else' }) as never,
    )

    const res = await balanceHandler(
      createNextRequest('/api/remote-wallets/w1/balance'),
      createParamsPromise({ id: 'w1' }),
    )
    expect(res.status).toBe(404)
    expect(getBalanceMock).not.toHaveBeenCalled()
  })

  it('returns 404 for a REVOKED wallet (no live balance)', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      createRemoteWalletFixture({ id: 'w1', userId: user.id, status: 'REVOKED' }) as never,
    )

    const res = await balanceHandler(
      createNextRequest('/api/remote-wallets/w1/balance'),
      createParamsPromise({ id: 'w1' }),
    )
    expect(res.status).toBe(404)
    expect(getBalanceMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the wallet does not exist', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(null as never)

    const res = await balanceHandler(
      createNextRequest('/api/remote-wallets/missing/balance'),
      createParamsPromise({ id: 'missing' }),
    )
    expect(res.status).toBe(404)
  })

  it('returns 503 when the driver fails to read the balance', async () => {
    mockAuth()
    const user = createUserFixture({ pubkey: USER_PUBKEY })
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(user as never)
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(
      createRemoteWalletFixture({ id: 'w1', userId: user.id, status: 'ACTIVE' }) as never,
    )
    getBalanceMock.mockRejectedValueOnce(new Error('relay timeout'))

    const res = await balanceHandler(
      createNextRequest('/api/remote-wallets/w1/balance'),
      createParamsPromise({ id: 'w1' }),
    )
    expect(res.status).toBe(503)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticate).mockRejectedValue(new AuthenticationError('No auth'))

    const res = await balanceHandler(
      createNextRequest('/api/remote-wallets/w1/balance'),
      createParamsPromise({ id: 'w1' }),
    )
    expect(res.status).toBe(401)
  })
})
