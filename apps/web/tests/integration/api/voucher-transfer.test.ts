import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey
} from 'nostr-tools/pure'
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
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {},
  logActivity: { fireAndForget: vi.fn() }
}))
vi.mock('@/lib/vouchers/status', () => ({
  refreshVoucherAtService: vi.fn(),
  fetchVoucherStatus: vi.fn()
}))

import { POST as CallbackPost } from '@/app/api/lud16/[username]/cb/route'
import { refreshVoucherAtService } from '@/lib/vouchers/status'

const serviceKey = generateSecretKey()
const servicePubkey = getPublicKey(serviceKey)
const merchantPubkey = 'c'.repeat(64)
const NONCE = 'hcLPDzERvvHzS4Vn0OLbAQ'
const NEW_NONCE = 'ZZZZZZZZZZZZZZZZZZZZZZ'

function signVoucher(key = serviceKey) {
  return JSON.parse(
    JSON.stringify(
      finalizeEvent(
        {
          kind: 20402,
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ['nonce', NONCE],
            ['p', merchantPubkey],
            ['coupon', '0f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'],
            ['phase', 'minted']
          ],
          content: JSON.stringify({ v: 1, nonce: NONCE })
        },
        key
      )
    )
  )
}

function transfer(overrides: Record<string, unknown> = {}) {
  return CallbackPost(
    createNextRequest('http://localhost:3000/api/lud16/alice/cb', {
      method: 'POST',
      body: {
        action: 'voucher',
        nonce: NONCE,
        voucher: signVoucher(),
        ...overrides
      }
    }) as any,
    createParamsPromise({ username: 'alice' })
  )
}

/** A recipient row, with the knobs the gate order cares about. */
function mockRecipient(
  o: {
    exists?: boolean
    allowVouchers?: boolean
    policy?: 'ANYONE' | 'ALLOWLIST'
  } = {}
) {
  vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(
    o.exists === false
      ? null
      : ({
          user: {
            id: 'user-1',
            allowVouchers: o.allowVouchers ?? true,
            voucherDepositPolicy: o.policy ?? 'ANYONE'
          }
        } as any)
  )
}

/** A prior voucher from this service — what pins it as known. */
function mockKnownService(
  refreshUrl: string | null = 'https://cms.test/refresh'
) {
  vi.mocked(prismaMock.voucher.findFirst).mockResolvedValue(
    refreshUrl
      ? ({
          claimUrl: 'https://cms.test/claim',
          refreshUrl,
          mintUrl: null,
          name: '20% off',
          description: null,
          imageUrl: null,
          metadata: null,
          expiresAt: null
        } as any)
      : null
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.voucherTransfer.findUnique).mockResolvedValue(null)
  vi.mocked(prismaMock.voucherTransfer.create).mockResolvedValue({
    id: 'wa-1',
    idempotencyKey: 'key-1'
  } as any)
  vi.mocked(prismaMock.voucherTransfer.update).mockResolvedValue({} as any)
  vi.mocked(prismaMock.voucher.count).mockResolvedValue(0)
  vi.mocked(prismaMock.voucher.create).mockResolvedValue({
    id: 'voucher-new'
  } as any)
  vi.mocked(refreshVoucherAtService).mockResolvedValue({
    nonce: NEW_NONCE,
    couponId: null,
    expiresAt: null,
    voucher: null,
    name: 'What the service calls it',
    description: null,
    image: null,
    benefit: { type: 'percent', percent: 25 }
  })
})

describe('POST {lud16 callback} action=voucher', () => {
  it('accepts a signed voucher from a known service', async () => {
    mockRecipient()
    mockKnownService()

    const data = await assertResponse(await transfer(), 200)
    expect(data).toEqual({ status: 'ACCEPTED' })

    // The replacement, not the nonce that arrived, is what we store.
    const created = vi.mocked(prismaMock.voucher.create).mock.calls[0][0] as any
    expect(created.data.nonce).toBe(NEW_NONCE)
    expect(created.data.servicePubkey).toBe(servicePubkey)
    expect(created.data.merchantPubkey).toBe(merchantPubkey)
  })

  it('describes the coupon from the service, not from a sibling row', async () => {
    // The recipient must see *this* coupon. The sender could choose any name,
    // and an older row from the same service describes a different coupon
    // entirely — both were live bugs before the refresh response was used.
    mockRecipient()
    mockKnownService()
    await transfer()

    const created = vi.mocked(prismaMock.voucher.create).mock.calls[0][0] as any
    expect(created.data.name).toBe('What the service calls it')
    expect(created.data.metadata).toEqual({
      coupon: { type: 'percent', percent: 25 }
    })
  })

  it('writes the intent down before burning anything', async () => {
    mockRecipient()
    mockKnownService()
    await transfer()

    const intentOrder = vi.mocked(prismaMock.voucherTransfer.create).mock
      .invocationCallOrder[0]
    const burnOrder = vi.mocked(refreshVoucherAtService).mock
      .invocationCallOrder[0]
    expect(intentOrder).toBeLessThan(burnOrder)
  })

  it('replays a completed transfer without touching the service', async () => {
    mockRecipient()
    mockKnownService()
    vi.mocked(prismaMock.voucherTransfer.findUnique).mockResolvedValue({
      id: 'wa-1',
      idempotencyKey: 'key-1',
      completedAt: new Date()
    } as any)

    const data = await assertResponse(await transfer(), 200)
    expect(data).toEqual({ status: 'ACCEPTED' })
    expect(refreshVoucherAtService).not.toHaveBeenCalled()
    expect(prismaMock.voucher.create).not.toHaveBeenCalled()
  })

  it('reuses the stored idempotency key when retrying an incomplete transfer', async () => {
    mockRecipient()
    mockKnownService()
    vi.mocked(prismaMock.voucherTransfer.findUnique).mockResolvedValue({
      id: 'wa-1',
      idempotencyKey: 'key-from-first-try',
      completedAt: null
    } as any)

    await transfer()
    expect(prismaMock.voucherTransfer.create).not.toHaveBeenCalled()
    expect(vi.mocked(refreshVoucherAtService).mock.calls[0][0]).toMatchObject({
      idempotencyKey: 'key-from-first-try'
    })
  })

  it('refuses a service the instance has never seen', async () => {
    // Pinning is the only thing standing between a forged voucher and a
    // stash entry that looks real until the till rejects it.
    mockRecipient()
    mockKnownService(null)

    const data = (await assertResponse(await transfer(), 200)) as any
    expect(data.status).toBe('ERROR')
    expect(refreshVoucherAtService).not.toHaveBeenCalled()
  })

  it('refuses a tampered signature', async () => {
    mockRecipient()
    mockKnownService()
    const event = signVoucher()
    event.sig = `${event.sig.slice(0, -1)}${event.sig.endsWith('a') ? 'b' : 'a'}`

    const data = (await assertResponse(
      await transfer({ voucher: event }),
      200
    )) as any
    expect(data.status).toBe('ERROR')
    expect(refreshVoucherAtService).not.toHaveBeenCalled()
  })

  it('refuses when the recipient has not opted in', async () => {
    mockRecipient({ allowVouchers: false })
    const data = (await assertResponse(await transfer(), 200)) as any
    expect(data.status).toBe('ERROR')
    expect(refreshVoucherAtService).not.toHaveBeenCalled()
  })

  it('refuses an ALLOWLIST recipient — an LNURL sender is anonymous', async () => {
    mockRecipient({ policy: 'ALLOWLIST' })
    const data = (await assertResponse(await transfer(), 200)) as any
    expect(data.status).toBe('ERROR')
  })

  it('answers an unknown recipient exactly like a closed one', async () => {
    mockRecipient({ allowVouchers: false })
    const closed = await (await transfer()).json()

    vi.clearAllMocks()
    mockRecipient({ exists: false })
    const unknown = await (await transfer()).json()

    expect(unknown).toEqual(closed)
  })

  it('does not store anything when the service refuses the swap', async () => {
    mockRecipient()
    mockKnownService()
    vi.mocked(refreshVoucherAtService).mockRejectedValue(new Error('409'))

    const data = (await assertResponse(await transfer(), 200)) as any
    expect(data.status).toBe('ERROR')
    expect(prismaMock.voucher.create).not.toHaveBeenCalled()
  })

  it('caps how many outstanding vouchers a stranger can pile up', async () => {
    mockRecipient()
    mockKnownService()
    vi.mocked(prismaMock.voucher.count).mockResolvedValue(100)

    const data = (await assertResponse(await transfer(), 200)) as any
    expect(data.status).toBe('ERROR')
    expect(refreshVoucherAtService).not.toHaveBeenCalled()
  })

  it('rejects an unsupported action', async () => {
    const response = await CallbackPost(
      createNextRequest('http://localhost:3000/api/lud16/alice/cb', {
        method: 'POST',
        body: { action: 'drain-wallet' }
      }) as any,
      createParamsPromise({ username: 'alice' })
    )
    expect(response.status).toBe(400)
  })
})
