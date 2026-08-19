import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey
} from 'nostr-tools/pure'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

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
  RateLimitPresets: { public: { bucket: 'public' } }
}))
vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))
vi.mock('@/lib/auth/account', () => ({ resolveAccountByPubkey: vi.fn() }))
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {},
  logActivity: { fireAndForget: vi.fn() }
}))

import { POST as Deposit } from '@/app/api/vouchers/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'

const serviceKey = generateSecretKey()
const servicePubkey = getPublicKey(serviceKey)
const recipientPubkey = 'b'.repeat(64)
const NONCE = 'hcLPDzERvvHzS4Vn0OLbAQ'

function mockAuth(pubkey = servicePubkey) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER' as any,
    method: 'nip98'
  })
}

function mockRecipient(
  overrides: {
    policy?: 'ANYONE' | 'ALLOWLIST'
    allowlist?: string[]
    exists?: boolean
  } = {}
) {
  if (overrides.exists === false) {
    vi.mocked(resolveAccountByPubkey).mockResolvedValue(null)
    return
  }
  vi.mocked(resolveAccountByPubkey).mockResolvedValue({ id: 'user-1' } as any)
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
    id: 'user-1',
    voucherDepositPolicy: overrides.policy ?? 'ANYONE',
    voucherSenderAllowlist: overrides.allowlist ?? []
  } as any)
}

function signVoucher(
  overrides: { tags?: string[][]; phase?: string } = {},
  key = serviceKey
) {
  return finalizeEvent(
    {
      kind: 20402,
      created_at: Math.floor(Date.now() / 1000),
      tags: overrides.tags ?? [
        ['nonce', NONCE],
        ['p', recipientPubkey],
        ['coupon', '0f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'],
        ['phase', overrides.phase ?? 'minted'],
        ['expiration', '1764633600']
      ],
      content: JSON.stringify({ v: 1, nonce: NONCE })
    },
    key
  )
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    npub: recipientPubkey,
    nonce: NONCE,
    name: '20% off any coffee',
    merchantPubkey: 'c'.repeat(64),
    claimUrl: 'https://merchant.example.com/api/coupons/claim',
    ...overrides
  }
}

function request(payload: Record<string, unknown>) {
  return createNextRequest('http://localhost:3000/api/vouchers', {
    method: 'POST',
    body: payload
  })
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(prismaMock.voucher.findUnique).mockResolvedValue(null)
  vi.mocked(prismaMock.voucher.upsert).mockResolvedValue({
    id: 'voucher-1',
    status: 'MINTED'
  } as any)
})

describe('POST /api/vouchers', () => {
  it('stores a voucher for a recipient who accepts anyone', async () => {
    mockAuth()
    mockRecipient()

    const response = await Deposit(request(body()))
    const data = await assertResponse(response, 201)

    expect(data).toEqual({ id: 'voucher-1', status: 'MINTED' })
    const args = vi.mocked(prismaMock.voucher.upsert).mock.calls[0][0] as any
    expect(args.create).toMatchObject({
      userId: 'user-1',
      nonce: NONCE,
      // With no signed event, the NIP-98 signer is recorded as the service.
      servicePubkey,
      depositedBy: servicePubkey
    })
  })

  it('accepts a valid signed voucher event and prefers its values', async () => {
    mockAuth('d'.repeat(64)) // A minter relaying on the service's behalf.
    mockRecipient()

    const response = await Deposit(
      request(
        body({
          voucherEvent: JSON.parse(JSON.stringify(signVoucher())),
          couponId: undefined
        })
      )
    )
    await assertResponse(response, 201)

    const args = vi.mocked(prismaMock.voucher.upsert).mock.calls[0][0] as any
    expect(args.create.servicePubkey).toBe(servicePubkey)
    expect(args.create.couponId).toBe('0f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9')
    expect(args.create.expiresAt).toEqual(new Date(1764633600 * 1000))
    expect(args.create.depositedBy).toBe('d'.repeat(64))
  })

  it('stores an already-claimed voucher as CLAIMED, not spendable', async () => {
    mockAuth()
    mockRecipient()

    await Deposit(
      request(
        body({
          voucherEvent: JSON.parse(
            JSON.stringify(signVoucher({ phase: 'claimed' }))
          )
        })
      )
    )

    const args = vi.mocked(prismaMock.voucher.upsert).mock.calls[0][0] as any
    expect(args.create.status).toBe('CLAIMED')
  })

  it('rejects a tampered signature', async () => {
    mockAuth()
    mockRecipient()

    const event = JSON.parse(JSON.stringify(signVoucher()))
    event.sig = `${event.sig.slice(0, -1)}${event.sig.endsWith('a') ? 'b' : 'a'}`

    const response = await Deposit(request(body({ voucherEvent: event })))
    expect(response.status).toBe(400)
    expect(prismaMock.voucher.upsert).not.toHaveBeenCalled()
  })

  it('rejects a voucher addressed to a different npub', async () => {
    mockAuth()
    mockRecipient()

    const event = JSON.parse(
      JSON.stringify(
        signVoucher({
          tags: [
            ['nonce', NONCE],
            ['p', 'e'.repeat(64)]
          ]
        })
      )
    )

    const response = await Deposit(request(body({ voucherEvent: event })))
    expect(response.status).toBe(400)
    expect(prismaMock.voucher.upsert).not.toHaveBeenCalled()
  })

  it('refuses a sender missing from the recipient’s allowlist', async () => {
    mockAuth()
    mockRecipient({ policy: 'ALLOWLIST', allowlist: ['f'.repeat(64)] })

    const response = await Deposit(request(body()))
    expect(response.status).toBe(403)
    expect(prismaMock.voucher.upsert).not.toHaveBeenCalled()
  })

  it('accepts a sender present in the allowlist', async () => {
    mockAuth()
    mockRecipient({ policy: 'ALLOWLIST', allowlist: [servicePubkey] })

    const response = await Deposit(request(body()))
    await assertResponse(response, 201)
  })

  it('gives an unknown npub the same refusal as a blocked sender', async () => {
    // The two must be indistinguishable, or this endpoint becomes an oracle
    // for which community members are registered here.
    mockAuth()
    mockRecipient({ policy: 'ALLOWLIST', allowlist: ['f'.repeat(64)] })
    const blocked = await Deposit(request(body()))
    const blockedBody = await blocked.json()

    vi.clearAllMocks()
    mockAuth()
    mockRecipient({ exists: false })
    const unknown = await Deposit(request(body()))
    const unknownBody = await unknown.json()

    expect(unknown.status).toBe(blocked.status)
    expect(unknownBody).toEqual(blockedBody)
  })

  it('is idempotent: a redeposit returns 200 and does not re-own the row', async () => {
    mockAuth()
    mockRecipient()
    vi.mocked(prismaMock.voucher.findUnique).mockResolvedValue({
      id: 'voucher-1'
    } as any)

    const response = await Deposit(request(body()))
    await assertResponse(response, 200)

    const args = vi.mocked(prismaMock.voucher.upsert).mock.calls[0][0] as any
    // The update path must not touch ownership or burn state.
    expect(args.update).not.toHaveProperty('userId')
    expect(args.update).not.toHaveProperty('status')
    expect(args.update).not.toHaveProperty('depositedBy')
  })

  it('rejects a non-https claimUrl in production', async () => {
    const previous = process.env.NODE_ENV
    vi.stubEnv('NODE_ENV', 'production')
    try {
      mockAuth()
      mockRecipient()
      const response = await Deposit(
        request(body({ claimUrl: 'http://merchant.example.com/claim' }))
      )
      expect(response.status).toBe(400)
      expect(prismaMock.voucher.upsert).not.toHaveBeenCalled()
    } finally {
      vi.stubEnv('NODE_ENV', previous ?? 'test')
      vi.unstubAllEnvs()
    }
  })

  it('rejects a claimUrl carrying credentials', async () => {
    mockAuth()
    mockRecipient()
    const response = await Deposit(
      request(
        body({ claimUrl: 'https://user:pass@merchant.example.com/claim' })
      )
    )
    expect(response.status).toBe(400)
  })

  it('rejects a nonce that is not 22 characters', async () => {
    mockAuth()
    mockRecipient()
    const response = await Deposit(request(body({ nonce: 'too-short' })))
    expect(response.status).toBe(400)
  })
})
