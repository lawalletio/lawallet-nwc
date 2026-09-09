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
vi.mock('@/lib/vouchers/deliver', () => ({ deliverVoucher: vi.fn() }))
vi.mock('@/lib/vouchers/status', () => ({ fetchVoucherStatus: vi.fn() }))

import { POST as Send } from '@/app/api/wallet/vouchers/[id]/send/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { deliverVoucher } from '@/lib/vouchers/deliver'
import { fetchVoucherStatus } from '@/lib/vouchers/status'

const ADDRESS = 'alice@wallet.example'

function voucherRow(overrides: Partial<any> = {}) {
  return {
    id: 'voucher-1',
    userId: 'user-1',
    nonce: 'hcLPDzERvvHzS4Vn0OLbAQ',
    couponId: null,
    name: '20% off',
    description: null,
    imageUrl: null,
    url: null,
    merchantPubkey: 'c'.repeat(64),
    servicePubkey: 'd'.repeat(64),
    claimUrl: 'https://cms.test/claim',
    refreshUrl: 'https://cms.test/refresh',
    mintUrl: null,
    metadata: null,
    voucherEvent: { kind: 20402 },
    status: 'MINTED',
    expiresAt: null,
    claimedAt: null,
    statusCheckedAt: null,
    depositedBy: 'd'.repeat(64),
    transferredTo: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides
  }
}

function send(body: Record<string, unknown> = { address: ADDRESS }) {
  return Send(
    createNextRequest(
      'http://localhost:3000/api/wallet/vouchers/voucher-1/send',
      { method: 'POST', body }
    ),
    createParamsPromise({ id: 'voucher-1' })
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: 'a'.repeat(64),
    role: 'USER' as any,
    method: 'jwt'
  })
  vi.mocked(resolveAccountByPubkey).mockResolvedValue({ id: 'user-1' } as any)
  vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(voucherRow() as any)
  // The conditional claim succeeds by default.
  vi.mocked(prismaMock.voucher.updateMany).mockResolvedValue({
    count: 1
  } as any)
  vi.mocked(prismaMock.voucher.update).mockResolvedValue(
    voucherRow({ status: 'TRANSFERRED', transferredTo: ADDRESS }) as any
  )
})

describe('POST /api/wallet/vouchers/[id]/send', () => {
  it('marks the voucher sent when the recipient accepts', async () => {
    vi.mocked(deliverVoucher).mockResolvedValue({ status: 'ACCEPTED' })

    const data = (await assertResponse(await send(), 200)) as any
    expect(data.voucher.status).toBe('TRANSFERRED')
    expect(data.voucher.transferredTo).toBe(ADDRESS)
  })

  it('claims the send with a conditional MINTED transition', async () => {
    // The guard against an honest double-send: two requests cannot both move
    // one nonce out of MINTED.
    vi.mocked(deliverVoucher).mockResolvedValue({ status: 'ACCEPTED' })
    await send()

    const claim = vi.mocked(prismaMock.voucher.updateMany).mock
      .calls[0][0] as any
    expect(claim.where).toMatchObject({ id: 'voucher-1', status: 'MINTED' })
    expect(claim.data).toMatchObject({ status: 'TRANSFER_PENDING' })
  })

  it('409s a second send while one is already in flight', async () => {
    vi.mocked(prismaMock.voucher.updateMany).mockResolvedValue({
      count: 0
    } as any)

    const response = await send()
    expect(response.status).toBe(409)
    expect(deliverVoucher).not.toHaveBeenCalled()
  })

  it('refuses a voucher whose service cannot refresh', async () => {
    vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(
      voucherRow({ refreshUrl: null }) as any
    )
    const response = await send()
    expect(response.status).toBe(400)
    expect(deliverVoucher).not.toHaveBeenCalled()
  })

  it('believes the coupon service, not a recipient that says no', async () => {
    // A recipient can swap the nonce and then answer ERROR. The service is
    // the only authority on who holds it now.
    vi.mocked(deliverVoucher).mockResolvedValue({
      status: 'ERROR',
      reason: 'nope'
    })
    vi.mocked(fetchVoucherStatus).mockResolvedValue({
      status: 'TRANSFERRED',
      claimedAt: null,
      expiresAt: null
    })

    const response = await send()
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body.error.message).toMatch(/already moved/)
  })

  it('leaves an ambiguous delivery pending rather than re-arming it', async () => {
    // Delivery failed and the service is unreachable, so we do not know
    // whether the nonce was burned. Defaulting back to MINTED here would let
    // it be sent a second time.
    vi.mocked(deliverVoucher).mockRejectedValue(new Error('network'))
    vi.mocked(fetchVoucherStatus).mockRejectedValue(new Error('unreachable'))

    const response = await send()
    expect(response.status).toBe(503)

    const writes = vi
      .mocked(prismaMock.voucher.update)
      .mock.calls.map(c => (c[0] as any).data)
    expect(writes.some(d => d.status === 'MINTED')).toBe(false)
    const conditional = vi.mocked(prismaMock.voucher.updateMany).mock.calls
    expect(conditional.some(c => (c[0] as any).data?.status === 'MINTED')).toBe(
      false
    )
  })

  it('re-arms the voucher when the service confirms it is still ours', async () => {
    vi.mocked(deliverVoucher).mockResolvedValue({
      status: 'ERROR',
      reason: 'nope'
    })
    vi.mocked(fetchVoucherStatus).mockResolvedValue({
      status: 'MINTED',
      claimedAt: null,
      expiresAt: null
    })

    const response = await send()
    expect(response.status).toBe(503)

    const rearm = vi
      .mocked(prismaMock.voucher.updateMany)
      .mock.calls.find(c => (c[0] as any).data?.status === 'MINTED')
    expect(rearm).toBeDefined()
    // Only from TRANSFER_PENDING — never stomping a terminal state.
    expect((rearm![0] as any).where).toMatchObject({
      status: 'TRANSFER_PENDING'
    })
  })

  it('404s for a voucher the caller does not own', async () => {
    vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(null)
    const response = await send()
    expect(response.status).toBe(404)
  })
})
