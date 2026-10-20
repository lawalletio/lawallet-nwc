import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { AuthorizationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { auth: {}, cardScan: {}, sensitive: {}, default: {} }
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn()
}))

// Address domain comes from settings, deliberately not the API host.
vi.mock('@/lib/settings', () => ({ getSettings: vi.fn() }))

vi.mock('@/lib/wallet/drivers', () => ({ driverForWallet: vi.fn() }))

import { GET } from '@/app/api/cards/[id]/owner/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission, Role } from '@/lib/auth/permissions'
import { getSettings } from '@/lib/settings'
import { driverForWallet } from '@/lib/wallet/drivers'
import { logger } from '@/lib/logger'

const OWNER_ID = 'owner-1'
const OWNER_PUBKEY = 'c'.repeat(64)
const WALLET = {
  id: 'w-primary',
  type: 'NWC',
  status: 'ACTIVE',
  config: { connectionString: 'nostr+walletconnect://primary' }
}

function mockOperator() {
  vi.mocked(authenticateWithPermission).mockResolvedValue({
    pubkey: 'a'.repeat(64),
    role: Role.OPERATOR,
    method: 'jwt'
  })
}

function ownedCard(overrides: Record<string, unknown> = {}) {
  return {
    disabledAt: null,
    user: {
      id: OWNER_ID,
      pubkey: OWNER_PUBKEY,
      cardRecoveryEnabled: true,
      lightningAddresses: [
        { username: 'alice', isPrimary: true },
        { username: 'alice2', isPrimary: false }
      ],
      _count: { cards: 2, remoteWallets: 3 }
    },
    ...overrides
  }
}

/** Owner has a primary address bound (CUSTOM_NWC) to `wallet`. */
function seedPrimaryWallet(wallet: Record<string, unknown> | null = WALLET) {
  vi.mocked(prismaMock.lightningAddress.count).mockResolvedValue(1)
  vi.mocked(prismaMock.lightningAddress.findFirst).mockResolvedValue({
    mode: 'CUSTOM_NWC',
    remoteWalletId: wallet ? (wallet.id as string) : null,
    remoteWallet: wallet
  } as any)
}

function seedBalance(balanceSats: number) {
  const getBalance = vi.fn().mockResolvedValue({ balanceSats })
  vi.mocked(driverForWallet).mockReturnValue({
    driver: { getBalance },
    config: { connectionString: 'decrypted' }
  } as any)
  return getBalance
}

function get(id = 'card1') {
  return GET(
    createNextRequest(`http://api.example/api/cards/${id}/owner`),
    createParamsPromise({ id })
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(getSettings).mockResolvedValue({ domain: 'lawallet.test' })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/cards/[id]/owner', () => {
  it('requires CARDS_READ', async () => {
    mockOperator()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/cards/card1/owner')
    await GET(req, createParamsPromise({ id: 'card1' }))

    expect(authenticateWithPermission).toHaveBeenCalledWith(
      req,
      Permission.CARDS_READ
    )
  })

  it('403s without the permission and reads nothing', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(
      new AuthorizationError('Not authorized')
    )

    const res = await get()

    expect(res.status).toBe(403)
    expect(prismaMock.card.findUnique).not.toHaveBeenCalled()
  })

  it('404s for an unknown card', async () => {
    mockOperator()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const res = await get('missing')

    expect(res.status).toBe(404)
  })

  it('reports an unowned card without reading a balance', async () => {
    mockOperator()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      disabledAt: null,
      user: null
    } as any)

    const body = await assertResponse(await get(), 200)

    expect(body).toEqual({ owned: false, cardDisabled: false })
    expect(driverForWallet).not.toHaveBeenCalled()
  })

  it('flags an unowned card that is paused', async () => {
    mockOperator()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      disabledAt: new Date(),
      user: null
    } as any)

    const body = await assertResponse(await get(), 200)

    expect(body).toEqual({ owned: false, cardDisabled: true })
  })

  it('returns the holder with full user@domain addresses and live balance', async () => {
    mockOperator()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(ownedCard() as any)
    seedPrimaryWallet()
    const getBalance = seedBalance(21_000)

    const body = await assertResponse(await get(), 200)

    expect(body).toEqual({
      owned: true,
      pubkey: OWNER_PUBKEY,
      // The LUD-16 domain from settings, not the api.example request host.
      primaryAddress: 'alice@lawallet.test',
      lightningAddresses: ['alice@lawallet.test', 'alice2@lawallet.test'],
      cards: 2,
      remoteWallets: 3,
      cardRecoveryEnabled: true,
      cardDisabled: false,
      balanceSats: 21_000
    })
    expect(driverForWallet).toHaveBeenCalledWith({
      id: WALLET.id,
      type: WALLET.type,
      config: WALLET.config
    })
    expect(getBalance).toHaveBeenCalledWith({ connectionString: 'decrypted' })
  })

  it('selects addresses primary-first and counts only live wallets', async () => {
    mockOperator()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(ownedCard() as any)
    seedPrimaryWallet()
    seedBalance(1)

    await get()

    const { select } = vi.mocked(prismaMock.card.findUnique).mock
      .calls[0][0] as any
    expect(select.user.select.lightningAddresses.orderBy).toEqual([
      { isPrimary: 'desc' },
      { createdAt: 'asc' }
    ])
    expect(select.user.select._count.select.remoteWallets).toEqual({
      where: { status: { notIn: ['REVOKED', 'DEAD'] } }
    })
  })

  it('surfaces a holder who turned recovery off and a paused card', async () => {
    mockOperator()
    const card = ownedCard({ disabledAt: new Date() })
    card.user.cardRecoveryEnabled = false
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    seedPrimaryWallet()
    seedBalance(5)

    const body: any = await assertResponse(await get(), 200)

    expect(body.cardRecoveryEnabled).toBe(false)
    expect(body.cardDisabled).toBe(true)
  })

  it('returns a null primary when the holder has only non-primary addresses', async () => {
    mockOperator()
    const card = ownedCard()
    card.user.lightningAddresses = [{ username: 'stray', isPrimary: false }]
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(prismaMock.lightningAddress.count).mockResolvedValue(0)
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue(null)

    const body: any = await assertResponse(await get(), 200)

    expect(body.primaryAddress).toBeNull()
    expect(body.lightningAddresses).toEqual(['stray@lawallet.test'])
  })

  it('reads an addressless holder balance from their ACTIVE NWC wallet', async () => {
    mockOperator()
    const card = ownedCard()
    card.user.lightningAddresses = []
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(prismaMock.lightningAddress.count).mockResolvedValue(0)
    vi.mocked(prismaMock.remoteWallet.findFirst).mockResolvedValue({
      ...WALLET,
      id: 'w-courtesy'
    } as any)
    seedBalance(777)

    const body: any = await assertResponse(await get(), 200)

    expect(prismaMock.remoteWallet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: OWNER_ID, status: 'ACTIVE', type: 'NWC' }
      })
    )
    expect(body.primaryAddress).toBeNull()
    expect(body.balanceSats).toBe(777)
  })

  it('returns a null balance when the driver throws', async () => {
    mockOperator()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(ownedCard() as any)
    seedPrimaryWallet()
    vi.mocked(driverForWallet).mockImplementation(() => {
      throw new Error('corrupt config')
    })

    const body: any = await assertResponse(await get(), 200)

    expect(body.owned).toBe(true)
    expect(body.balanceSats).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OWNER_ID, walletId: WALLET.id }),
      'Card owner balance unavailable'
    )
  })

  it('returns a null balance when getBalance rejects', async () => {
    mockOperator()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(ownedCard() as any)
    seedPrimaryWallet()
    vi.mocked(driverForWallet).mockReturnValue({
      driver: {
        getBalance: vi.fn().mockRejectedValue(new Error('relay down'))
      },
      config: {}
    } as any)

    const body: any = await assertResponse(await get(), 200)

    expect(body.balanceSats).toBeNull()
  })

  it.each(['REVOKED', 'DEAD'])(
    'skips the driver for a %s wallet',
    async status => {
      mockOperator()
      vi.mocked(prismaMock.card.findUnique).mockResolvedValue(
        ownedCard() as any
      )
      seedPrimaryWallet({ ...WALLET, status })

      const body: any = await assertResponse(await get(), 200)

      expect(body.balanceSats).toBeNull()
      expect(driverForWallet).not.toHaveBeenCalled()
    }
  )

  it('returns a null balance when the primary address has no wallet', async () => {
    mockOperator()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(ownedCard() as any)
    seedPrimaryWallet(null)

    const body: any = await assertResponse(await get(), 200)

    expect(body.balanceSats).toBeNull()
    expect(driverForWallet).not.toHaveBeenCalled()
  })

  it('gives up on a wallet that does not answer within 5 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    mockOperator()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(ownedCard() as any)
    seedPrimaryWallet()
    vi.mocked(driverForWallet).mockReturnValue({
      driver: { getBalance: vi.fn(() => new Promise(() => {})) },
      config: {}
    } as any)

    const pending = get()
    await vi.advanceTimersByTimeAsync(5_000)
    const body: any = await assertResponse(await pending, 200)

    expect(body.owned).toBe(true)
    expect(body.balanceSats).toBeNull()
  })
})
