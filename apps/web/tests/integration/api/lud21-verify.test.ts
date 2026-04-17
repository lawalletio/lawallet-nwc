import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

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

const lookupInvoiceMock = vi.fn()
const nwcCloseMock = vi.fn()

vi.mock('@getalby/sdk', () => ({
  NWCClient: vi.fn().mockImplementation(() => ({
    lookupInvoice: lookupInvoiceMock,
    close: nwcCloseMock,
  })),
}))

import { GET } from '@/app/api/lud16/[username]/verify/[paymentHash]/route'

const VALID_HASH = 'a'.repeat(64)
const FUTURE = new Date(Date.now() + 60 * 60 * 1000)
const PAST = new Date(Date.now() - 60 * 60 * 1000)

const baseInvoice = {
  id: 'inv-1',
  paymentHash: VALID_HASH,
  bolt11: 'lnbc100n1test',
  amountSats: 10,
  status: 'PENDING' as const,
  preimage: null as string | null,
  expiresAt: FUTURE,
  user: {
    id: 'user-1',
    nwc: 'nostr+walletconnect://abc',
    lightningAddresses: [{ username: 'alice' }],
  },
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/lud16/[username]/verify/[paymentHash]', () => {
  it('rejects invalid payment hash format', async () => {
    const req = createNextRequest('/api/lud16/alice/verify/short')
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: 'short' })
    )
    const body: any = await assertResponse(res, 400)

    expect(body.status).toBe('ERROR')
    expect(body.reason).toContain('Invalid')
    expect(prismaMock.invoice.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 when invoice not found', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(null)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )

    expect(res.status).toBe(404)
  })

  it('returns 404 when username does not match invoice owner', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      user: { ...baseInvoice.user, lightningAddresses: [{ username: 'bob' }] },
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )

    expect(res.status).toBe(404)
  })

  it('returns cached preimage when invoice already PAID', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      status: 'PAID',
      preimage: 'b'.repeat(64),
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({
      status: 'OK',
      settled: true,
      preimage: 'b'.repeat(64),
      pr: 'lnbc100n1test',
    })
    // Should not query NWC when already cached
    expect(lookupInvoiceMock).not.toHaveBeenCalled()
  })

  it('returns unsettled for expired invoices without querying NWC', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      expiresAt: PAST,
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body).toEqual({
      status: 'OK',
      settled: false,
      preimage: null,
      pr: 'lnbc100n1test',
    })
    expect(lookupInvoiceMock).not.toHaveBeenCalled()
  })

  it('queries NWC and persists settled state when payment arrives', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(baseInvoice as any)
    lookupInvoiceMock.mockResolvedValue({
      state: 'settled',
      preimage: 'c'.repeat(64),
      settled_at: 1_700_000_000,
    })

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.settled).toBe(true)
    expect(body.preimage).toBe('c'.repeat(64))
    expect(lookupInvoiceMock).toHaveBeenCalledWith({ payment_hash: VALID_HASH })
    expect(prismaMock.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentHash: VALID_HASH },
        data: expect.objectContaining({
          status: 'PAID',
          preimage: 'c'.repeat(64),
        }),
      })
    )
    expect(nwcCloseMock).toHaveBeenCalled()
  })

  it('returns unsettled without preimage when NWC says pending', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(baseInvoice as any)
    lookupInvoiceMock.mockResolvedValue({
      state: 'pending',
      preimage: '',
    })

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.settled).toBe(false)
    expect(body.preimage).toBeNull()
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
  })

  it('returns unsettled when NWC call fails (retry-later semantics)', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue(baseInvoice as any)
    lookupInvoiceMock.mockRejectedValue(new Error('relay timeout'))

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.status).toBe('OK')
    expect(body.settled).toBe(false)
    expect(body.preimage).toBeNull()
    expect(prismaMock.invoice.update).not.toHaveBeenCalled()
  })

  it('returns unsettled when user has no NWC configured', async () => {
    vi.mocked(prismaMock.invoice.findUnique).mockResolvedValue({
      ...baseInvoice,
      user: { ...baseInvoice.user, nwc: null },
    } as any)

    const req = createNextRequest(`/api/lud16/alice/verify/${VALID_HASH}`)
    const res = await GET(
      req,
      createParamsPromise({ username: 'alice', paymentHash: VALID_HASH })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.settled).toBe(false)
    expect(lookupInvoiceMock).not.toHaveBeenCalled()
  })
})
