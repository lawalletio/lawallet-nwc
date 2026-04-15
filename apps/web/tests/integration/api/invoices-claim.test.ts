import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxJsonBodySize: 102400 },
  })),
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
  authenticate: vi
    .fn()
    .mockResolvedValue({ pubkey: 'a'.repeat(64), role: 'USER', method: 'jwt' }),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn().mockResolvedValue({ domain: 'test.com' }),
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() },
}))

import { POST } from '@/app/api/invoices/[id]/claim/route'

// Deterministic preimage + matching payment hash
const PREIMAGE = 'a'.repeat(64)
const PAYMENT_HASH = createHash('sha256')
  .update(Buffer.from(PREIMAGE, 'hex'))
  .digest('hex')

const baseInvoice = {
  id: 'inv-1',
  paymentHash: PAYMENT_HASH,
  bolt11: 'lnbc...',
  amountSats: 21,
  description: 'Registration',
  purpose: 'REGISTRATION' as const,
  metadata: { username: 'alice' },
  status: 'PENDING' as const,
  preimage: null as string | null,
  userId: 'user-1',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  createdAt: new Date(),
  paidAt: null,
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
    id: 'user-1',
    pubkey: 'a'.repeat(64),
  } as any)
})

describe('POST /api/invoices/[id]/claim', () => {
  it('rejects invalid preimage format', async () => {
    const req = createNextRequest('/api/invoices/inv-1/claim', {
      method: 'POST',
      body: { preimage: 'not-hex' },
    })
    const res = await POST(req, createParamsPromise({ id: 'inv-1' }))

    expect(res.status).toBe(400)
  })

  it('returns 404 when invoice not found', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/invoices/inv-1/claim', {
      method: 'POST',
      body: { preimage: PREIMAGE },
    })
    const res = await POST(req, createParamsPromise({ id: 'inv-1' }))

    expect(res.status).toBe(404)
  })

  it('rejects claim when invoice belongs to another user', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      userId: 'other-user',
    } as any)

    const req = createNextRequest('/api/invoices/inv-1/claim', {
      method: 'POST',
      body: { preimage: PREIMAGE },
    })
    const res = await POST(req, createParamsPromise({ id: 'inv-1' }))

    expect(res.status).toBe(403)
  })

  it('rejects already claimed invoice with 409', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      status: 'PAID',
      preimage: PREIMAGE,
    } as any)

    const req = createNextRequest('/api/invoices/inv-1/claim', {
      method: 'POST',
      body: { preimage: PREIMAGE },
    })
    const res = await POST(req, createParamsPromise({ id: 'inv-1' }))

    expect(res.status).toBe(409)
  })

  it('rejects expired invoice', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      expiresAt: new Date(Date.now() - 60_000),
    } as any)

    const req = createNextRequest('/api/invoices/inv-1/claim', {
      method: 'POST',
      body: { preimage: PREIMAGE },
    })
    const res = await POST(req, createParamsPromise({ id: 'inv-1' }))

    expect(res.status).toBe(400)
  })

  it('rejects preimage that does not hash to paymentHash', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(baseInvoice as any)

    const wrongPreimage = 'b'.repeat(64)
    const req = createNextRequest('/api/invoices/inv-1/claim', {
      method: 'POST',
      body: { preimage: wrongPreimage },
    })
    const res = await POST(req, createParamsPromise({ id: 'inv-1' }))

    expect(res.status).toBe(400)
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
    expect(prismaMock.lightningAddress.create).not.toHaveBeenCalled()
  })

  it('marks invoice PAID and creates lightning address on REGISTRATION', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(baseInvoice as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/invoices/inv-1/claim', {
      method: 'POST',
      body: { preimage: PREIMAGE },
    })
    const res = await POST(req, createParamsPromise({ id: 'inv-1' }))
    const body: any = await assertResponse(res, 200)

    expect(body.success).toBe(true)
    expect(body.username).toBe('alice')
    expect(body.lightningAddress).toBe('alice@test.com')

    // Invoice marked PAID with preimage
    expect(prismaMock.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inv-1' },
        data: expect.objectContaining({
          status: 'PAID',
          preimage: PREIMAGE,
        }),
      })
    )
    // Lightning address created for the claiming user
    expect(prismaMock.lightningAddress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { username: 'alice', userId: 'user-1' },
      })
    )
  })

  it('returns 409 when username was taken between invoice + claim', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(baseInvoice as any)
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      userId: 'someone-else',
    } as any)

    const req = createNextRequest('/api/invoices/inv-1/claim', {
      method: 'POST',
      body: { preimage: PREIMAGE },
    })
    const res = await POST(req, createParamsPromise({ id: 'inv-1' }))

    expect(res.status).toBe(409)
    // Invoice still marked paid (preimage valid), but address not created
    expect(prismaMock.lightningAddress.create).not.toHaveBeenCalled()
  })

  it('deletes the old lightning address before creating the new one', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(baseInvoice as any)
    // Username free globally but user already has a different address
    ;(prismaMock.lightningAddress.findUnique as any).mockImplementation(
      async ({ where }: any) => {
        if (where.username === 'alice') return null
        if (where.userId === 'user-1') {
          return { username: 'old-name', userId: 'user-1' } as any
        }
        return null
      }
    )

    const req = createNextRequest('/api/invoices/inv-1/claim', {
      method: 'POST',
      body: { preimage: PREIMAGE },
    })
    const res = await POST(req, createParamsPromise({ id: 'inv-1' }))
    await assertResponse(res, 200)

    expect(prismaMock.lightningAddress.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } })
    )
    expect(prismaMock.lightningAddress.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { username: 'alice', userId: 'user-1' },
      })
    )
  })

  it('rejects REGISTRATION invoice missing username metadata', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      metadata: {},
    } as any)

    const req = createNextRequest('/api/invoices/inv-1/claim', {
      method: 'POST',
      body: { preimage: PREIMAGE },
    })
    const res = await POST(req, createParamsPromise({ id: 'inv-1' }))

    expect(res.status).toBe(400)
  })
})
