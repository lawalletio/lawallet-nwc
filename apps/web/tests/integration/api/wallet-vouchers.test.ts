import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { public: {}, sensitive: {} }
}))
vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))
vi.mock('@/lib/auth/account', () => ({ resolveAccountByPubkey: vi.fn() }))
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {},
  logActivity: { fireAndForget: vi.fn() }
}))
vi.mock('@/lib/vouchers/status', () => ({ fetchVoucherStatus: vi.fn() }))

import { GET as ListGet } from '@/app/api/wallet/vouchers/route'
import {
  GET as DetailGet,
  DELETE as DetailDelete
} from '@/app/api/wallet/vouchers/[id]/route'
import { POST as Refresh } from '@/app/api/wallet/vouchers/[id]/refresh/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { fetchVoucherStatus } from '@/lib/vouchers/status'

const pubkey = 'a'.repeat(64)

function mockAuth() {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER' as any,
    method: 'jwt'
  })
  vi.mocked(resolveAccountByPubkey).mockResolvedValue({ id: 'user-1' } as any)
}

function voucherRow(overrides: Partial<any> = {}) {
  return {
    id: 'voucher-1',
    nonce: 'hcLPDzERvvHzS4Vn0OLbAQ',
    couponId: null,
    name: '20% off',
    description: null,
    imageUrl: null,
    merchantPubkey: 'c'.repeat(64),
    servicePubkey: 'd'.repeat(64),
    claimUrl: 'https://merchant.example.com/api/coupons/claim',
    mintUrl: null,
    metadata: null,
    voucherEvent: null,
    status: 'MINTED',
    expiresAt: null,
    claimedAt: null,
    statusCheckedAt: null,
    depositedBy: 'd'.repeat(64),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  }
}

// `createParamsPromise` returns the whole route context, not just the promise.
const ctx = () => createParamsPromise({ id: 'voucher-1' })

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/wallet/vouchers', () => {
  it('returns only the caller’s vouchers', async () => {
    mockAuth()
    vi.mocked(prismaMock.voucher.findMany).mockResolvedValue([
      voucherRow()
    ] as any)

    const response = await ListGet(
      createNextRequest('http://localhost:3000/api/wallet/vouchers')
    )
    const data = await assertResponse(response, 200)

    expect(data).toHaveLength(1)
    expect(
      vi.mocked(prismaMock.voucher.findMany).mock.calls[0][0]
    ).toMatchObject({ where: { userId: 'user-1' } })
  })

  it('passes a status filter through', async () => {
    mockAuth()
    vi.mocked(prismaMock.voucher.findMany).mockResolvedValue([] as any)

    await ListGet(
      createNextRequest(
        'http://localhost:3000/api/wallet/vouchers?status=CLAIMED'
      )
    )

    expect(
      vi.mocked(prismaMock.voucher.findMany).mock.calls[0][0]
    ).toMatchObject({ where: { userId: 'user-1', status: 'CLAIMED' } })
  })
})

describe('GET /api/wallet/vouchers/[id]', () => {
  it('returns a voucher the caller owns', async () => {
    mockAuth()
    vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(
      voucherRow() as any
    )

    const response = await DetailGet(
      createNextRequest('http://localhost:3000/api/wallet/vouchers/voucher-1'),
      ctx()
    )
    const data = (await assertResponse(response, 200)) as any
    expect(data.id).toBe('voucher-1')
  })

  it('404s rather than 403s for somebody else’s voucher, so ids can’t be probed', async () => {
    mockAuth()
    vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(null)

    const response = await DetailGet(
      createNextRequest('http://localhost:3000/api/wallet/vouchers/voucher-1'),
      ctx()
    )
    expect(response.status).toBe(404)
  })
})

describe('DELETE /api/wallet/vouchers/[id]', () => {
  it('removes the caller’s own voucher', async () => {
    mockAuth()
    vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(
      voucherRow() as any
    )
    vi.mocked(prismaMock.voucher.delete).mockResolvedValue({} as any)

    const response = await DetailDelete(
      createNextRequest('http://localhost:3000/api/wallet/vouchers/voucher-1', {
        method: 'DELETE'
      }),
      ctx()
    )
    await assertResponse(response, 200)
    expect(prismaMock.voucher.delete).toHaveBeenCalledWith({
      where: { id: 'voucher-1' }
    })
  })
})

describe('POST /api/wallet/vouchers/[id]/refresh', () => {
  function refreshRequest() {
    return createNextRequest(
      'http://localhost:3000/api/wallet/vouchers/voucher-1/refresh',
      { method: 'POST' }
    )
  }

  it('persists a claimed status reported by the service', async () => {
    mockAuth()
    vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(
      voucherRow() as any
    )
    const claimedAt = new Date('2026-02-01T10:00:00Z')
    vi.mocked(fetchVoucherStatus).mockResolvedValue({
      status: 'CLAIMED',
      claimedAt,
      expiresAt: null
    })
    vi.mocked(prismaMock.voucher.update).mockResolvedValue(
      voucherRow({ status: 'CLAIMED', claimedAt }) as any
    )

    const response = await Refresh(refreshRequest(), ctx())
    const data = (await assertResponse(response, 200)) as any

    expect(data.checked).toBe(true)
    expect(data.voucher.status).toBe('CLAIMED')
    expect(vi.mocked(prismaMock.voucher.update).mock.calls[0][0]).toMatchObject(
      { data: { status: 'CLAIMED', claimedAt } }
    )
  })

  it('does not poll a voucher that is already terminal', async () => {
    mockAuth()
    vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(
      voucherRow({ status: 'CLAIMED' }) as any
    )

    const response = await Refresh(refreshRequest(), ctx())
    const data = (await assertResponse(response, 200)) as any

    expect(data.checked).toBe(false)
    expect(fetchVoucherStatus).not.toHaveBeenCalled()
    expect(prismaMock.voucher.update).not.toHaveBeenCalled()
  })

  it('skips a poll that is still inside the cooldown', async () => {
    mockAuth()
    vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(
      voucherRow({ statusCheckedAt: new Date() }) as any
    )

    const response = await Refresh(refreshRequest(), ctx())
    const data = (await assertResponse(response, 200)) as any

    expect(data.checked).toBe(false)
    expect(fetchVoucherStatus).not.toHaveBeenCalled()
  })

  it('polls again once the cooldown has elapsed', async () => {
    mockAuth()
    vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(
      voucherRow({ statusCheckedAt: new Date(Date.now() - 120_000) }) as any
    )
    vi.mocked(fetchVoucherStatus).mockResolvedValue({
      status: 'MINTED',
      claimedAt: null,
      expiresAt: null
    })
    vi.mocked(prismaMock.voucher.update).mockResolvedValue(voucherRow() as any)

    const response = await Refresh(refreshRequest(), ctx())
    const data = (await assertResponse(response, 200)) as any

    expect(data.checked).toBe(true)
    expect(fetchVoucherStatus).toHaveBeenCalledOnce()
  })

  it('404s for a voucher the caller does not own', async () => {
    mockAuth()
    vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(null)

    const response = await Refresh(refreshRequest(), ctx())
    expect(response.status).toBe(404)
    expect(fetchVoucherStatus).not.toHaveBeenCalled()
  })
})
