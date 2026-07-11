import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { Permission, Role } from '@/lib/auth/permissions'

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
  authenticateWithPermission: vi.fn()
}))

vi.mock('@/lib/invoice-utils', () => ({
  extractDescription: vi.fn((bolt11: string) => `memo:${bolt11}`)
}))

import { GET } from '@/app/api/cards/[id]/transactions/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'

function mockAdmin() {
  vi.mocked(authenticateWithPermission).mockResolvedValue({
    pubkey: 'admin',
    role: Role.ADMIN,
    method: 'jwt'
  })
}

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    walletId: 'wallet-1',
    paymentHash: 'a'.repeat(64),
    bolt11: 'lnbc-attempt-1',
    amountMsats: 21_000,
    transport: 'LISTENER',
    status: 'SUCCEEDED',
    errorCode: null,
    createdAt: new Date('2026-07-10T18:00:00.000Z'),
    ...overrides
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/cards/[id]/transactions', () => {
  it('returns durable payment attempts with compatible and exact statuses', async () => {
    mockAdmin()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1'
    } as any)
    vi.mocked(prismaMock.cardPaymentAttempt.findMany).mockResolvedValue([
      attempt(),
      attempt({
        id: 'attempt-2',
        walletId: 'deleted-wallet',
        paymentHash: 'b'.repeat(64),
        bolt11: 'lnbc-attempt-2',
        amountMsats: 1500,
        transport: 'DIRECT',
        status: 'REJECTED',
        errorCode: 'WALLET_REJECTED'
      }),
      attempt({
        id: 'attempt-3',
        paymentHash: 'c'.repeat(64),
        bolt11: 'lnbc-attempt-3',
        status: 'UNKNOWN',
        errorCode: 'PAYMENT_OUTCOME_UNKNOWN'
      }),
      attempt({
        id: 'attempt-4',
        paymentHash: 'd'.repeat(64),
        bolt11: 'lnbc-attempt-4',
        status: 'PENDING'
      })
    ] as any)
    vi.mocked(prismaMock.remoteWallet.findMany).mockResolvedValue([
      { id: 'wallet-1', type: 'NWC' }
    ] as any)

    const req = createNextRequest('/api/cards/card-1/transactions')
    const body: any = await assertResponse(
      await GET(req, createParamsPromise({ id: 'card-1' })),
      200
    )

    expect(body.items[0]).toEqual({
      id: 'attempt-1',
      createdAt: '2026-07-10T18:00:00.000Z',
      amountSats: 21,
      status: 'success',
      error: null,
      walletType: 'NWC',
      bolt11: 'lnbc-attempt-1',
      description: 'memo:lnbc-attempt-1',
      paymentHash: 'a'.repeat(64),
      paymentStatus: 'SUCCEEDED',
      transport: 'LISTENER'
    })
    expect(
      body.items.map((item: any) => ({
        status: item.status,
        paymentStatus: item.paymentStatus,
        transport: item.transport,
        error: item.error
      }))
    ).toEqual([
      {
        status: 'success',
        paymentStatus: 'SUCCEEDED',
        transport: 'LISTENER',
        error: null
      },
      {
        status: 'failed',
        paymentStatus: 'REJECTED',
        transport: 'DIRECT',
        error: 'WALLET_REJECTED'
      },
      {
        status: 'failed',
        paymentStatus: 'UNKNOWN',
        transport: 'LISTENER',
        error: 'PAYMENT_OUTCOME_UNKNOWN'
      },
      {
        status: 'failed',
        paymentStatus: 'PENDING',
        transport: 'LISTENER',
        error: null
      }
    ])
    expect(body.items[1].amountSats).toBe(1.5)
    expect(body.items[1].walletType).toBeNull()
    expect(prismaMock.cardPaymentAttempt.findMany).toHaveBeenCalledWith({
      where: { cardId: 'card-1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        walletId: true,
        paymentHash: true,
        bolt11: true,
        amountMsats: true,
        transport: true,
        status: true,
        errorCode: true,
        createdAt: true
      }
    })
    expect(prismaMock.remoteWallet.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['wallet-1', 'deleted-wallet'] } },
      select: { id: true, type: true }
    })
    expect(authenticateWithPermission).toHaveBeenCalledWith(
      req,
      Permission.CARDS_READ
    )
  })

  it('returns an empty list without querying wallets', async () => {
    mockAdmin()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue({
      id: 'card-1'
    } as any)
    vi.mocked(prismaMock.cardPaymentAttempt.findMany).mockResolvedValue([])

    const body: any = await assertResponse(
      await GET(
        createNextRequest('/api/cards/card-1/transactions'),
        createParamsPromise({ id: 'card-1' })
      ),
      200
    )

    expect(body).toEqual({ items: [] })
    expect(prismaMock.remoteWallet.findMany).not.toHaveBeenCalled()
  })

  it('returns 404 for a missing card without reading attempts', async () => {
    mockAdmin()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)

    const response = await GET(
      createNextRequest('/api/cards/missing/transactions'),
      createParamsPromise({ id: 'missing' })
    )

    expect(response.status).toBe(404)
    expect(prismaMock.cardPaymentAttempt.findMany).not.toHaveBeenCalled()
  })

  it('rejects callers without card-read permission', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(
      new Error('unauthorized')
    )

    const response = await GET(
      createNextRequest('/api/cards/card-1/transactions'),
      createParamsPromise({ id: 'card-1' })
    )

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(prismaMock.card.findUnique).not.toHaveBeenCalled()
  })
})
