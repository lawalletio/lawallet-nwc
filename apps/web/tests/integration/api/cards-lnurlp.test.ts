import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createCardFixture, createUserFixture } from '@/tests/helpers/fixtures'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    nwcVault: {
      secret: 'test-card-lnurlp-vault-secret-0123456789abcd',
      enabled: true
    }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: {
    auth: {},
    cardScan: {},
    lud16: {},
    sensitive: {},
    default: {}
  }
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

vi.mock('@/lib/card-payments/max-withdrawable', () => ({
  resolveCardMaxWithdrawableMsats: vi.fn().mockResolvedValue(25_000_000)
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

const makeInvoiceMock = vi.fn().mockResolvedValue({
  invoice: 'lnbc100n1cardtopup',
  payment_hash: 'ab'.repeat(32),
  amount: 10_000,
  description: 'BoltCard top-up',
  expires_at: 1_700_000_600
})
const nwcCtorMock = vi.fn()

vi.mock('@getalby/sdk', () => {
  class FakeNWCClient {
    constructor(opts: { nostrWalletConnectUrl: string }) {
      nwcCtorMock(opts)
    }
    makeInvoice = makeInvoiceMock
    close = vi.fn()
  }
  return { NWCClient: FakeNWCClient }
})

vi.mock('light-bolt11-decoder', () => ({
  decode: vi.fn().mockReturnValue({
    sections: [
      { name: 'timestamp', value: 1_700_000_000 },
      { name: 'expiry', value: 600 },
      { name: 'payment_hash', value: 'ab'.repeat(32) }
    ]
  })
}))

import { GET as ScanGet } from '@/app/api/cards/[id]/scan/route'
import {
  GET as LnurlpGet,
  OPTIONS as LnurlpOptions
} from '@/app/api/cards/[id]/lnurlp/route'
import {
  GET as LnurlpCbGet,
  OPTIONS as LnurlpCbOptions
} from '@/app/api/cards/[id]/lnurlp/cb/route'
import { getSettings } from '@/lib/settings'
import { closeAllServerNwcClients } from '@/lib/wallet/drivers/nwc-client-cache'
import { eventBus } from '@/lib/events/event-bus'

function nwcUri(walletKey: string, secret: string, relay: string): string {
  return `nostr+walletconnect://${walletKey.repeat(64)}?relay=${encodeURIComponent(`wss://${relay}`)}&secret=${secret.repeat(64)}`
}

const CARD_NWC_URI = nwcUri('a', 'b', 'card.relay.test')
const PRIMARY_NWC_URI = nwcUri('c', 'd', 'primary.relay.test')

const CARD_WALLET = {
  id: 'wallet-card',
  type: 'NWC' as const,
  config: {
    connectionString: CARD_NWC_URI,
    mode: 'SEND_RECEIVE' as 'RECEIVE' | 'SEND_RECEIVE'
  },
  status: 'ACTIVE' as const
}

const PRIMARY_WALLET = {
  id: 'wallet-primary',
  type: 'NWC' as const,
  config: { connectionString: PRIMARY_NWC_URI, mode: 'RECEIVE' as const },
  status: 'ACTIVE' as const
}

function receivableCard(
  overrides: {
    remoteWallet?: typeof CARD_WALLET | null
    user?: ReturnType<typeof owner> | null
    blockedAt?: Date | null
    disabledAt?: Date | null
  } = {}
) {
  return {
    ...createCardFixture(),
    userId: 'user-1',
    blockedAt: overrides.blockedAt ?? null,
    disabledAt: overrides.disabledAt ?? null,
    remoteWallet:
      overrides.remoteWallet === undefined
        ? CARD_WALLET
        : overrides.remoteWallet,
    user: overrides.user === undefined ? owner() : overrides.user
  }
}

function owner(wallet: typeof PRIMARY_WALLET | null = PRIMARY_WALLET) {
  return {
    ...createUserFixture({ id: 'user-1' }),
    lightningAddresses: wallet
      ? [
          {
            mode: 'CUSTOM_NWC' as const,
            remoteWalletId: wallet.id,
            remoteWallet: wallet
          }
        ]
      : []
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  closeAllServerNwcClients()
  makeInvoiceMock.mockResolvedValue({
    invoice: 'lnbc100n1cardtopup',
    payment_hash: 'ab'.repeat(32),
    amount: 10_000,
    description: 'BoltCard top-up',
    expires_at: 1_700_000_600
  })
  vi.mocked(getSettings).mockResolvedValue({
    domain: 'example.com',
    endpoint: 'https://pay.example.com'
  })
  vi.mocked(prismaMock.invoice.upsert).mockResolvedValue({
    id: 'invoice-1',
    paymentHash: 'ab'.repeat(32)
  } as any)
})

describe('OPTIONS /api/cards/[id]/lnurlp', () => {
  it('allows cross-origin discovery and callback preflights', () => {
    for (const response of [LnurlpOptions(), LnurlpCbOptions()]) {
      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain(
        'GET'
      )
    }
  })
})

describe('card LUD-19 payLink', () => {
  it('follows payLink to a payRequest that mints on the card wallet', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const scanRes = await ScanGet(
      createNextRequest(`/api/cards/${card.id}/scan`, {
        searchParams: { p: 'A'.repeat(32), c: 'B'.repeat(16) }
      }),
      createParamsPromise({ id: card.id })
    )
    const scan: any = await assertResponse(scanRes, 200)
    expect(scan.tag).toBe('withdrawRequest')
    expect(scan.payLink).toBe(
      `lnurlp://pay.example.com/api/cards/${card.id}/lnurlp`
    )
    expect(scan.payLink).not.toContain('/api/lud16/')

    const payRes = await LnurlpGet(
      createNextRequest(`https://pay.example.com/api/cards/${card.id}/lnurlp`),
      createParamsPromise({ id: card.id })
    )
    const pay: any = await assertResponse(payRes, 200)
    expect(pay.tag).toBe('payRequest')
    expect(pay.callback).toBe(
      `https://pay.example.com/api/cards/${card.id}/lnurlp/cb`
    )
    expect(pay.minSendable).toBe(1000)
    expect(pay.maxSendable).toBe(1_000_000_000)
    expect(JSON.parse(pay.metadata)).toEqual([
      ['text/plain', 'BoltCard top-up']
    ])
    expect(pay.commentAllowed).toBe(200)

    const cbRes = await LnurlpCbGet(
      createNextRequest(pay.callback, {
        searchParams: { amount: '10000', comment: 'top up' }
      }),
      createParamsPromise({ id: card.id })
    )
    const cb: any = await assertResponse(cbRes, 200)
    expect(cb.pr).toBe('lnbc100n1cardtopup')
    expect(cb.routes).toEqual([])
    expect(cb.status).toBeUndefined()

    expect(nwcCtorMock).toHaveBeenCalledWith({
      nostrWalletConnectUrl: CARD_NWC_URI
    })
    expect(nwcCtorMock).not.toHaveBeenCalledWith({
      nostrWalletConnectUrl: PRIMARY_NWC_URI
    })
    expect(makeInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 10_000,
        description: 'BoltCard top-up: top up'
      })
    )
    expect(prismaMock.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          purpose: 'CARD_TOPUP',
          userId: 'user-1',
          remoteWalletId: 'wallet-card',
          amountMsats: BigInt(10_000),
          metadata: { cardId: card.id, comment: 'top up' }
        })
      })
    )
    expect(eventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'invoices:updated' })
    )
  })

  it('mints on the primary wallet when the card has no explicit binding', async () => {
    const card = receivableCard({ remoteWallet: null })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const pay: any = await assertResponse(
      await LnurlpGet(
        createNextRequest(`/api/cards/${card.id}/lnurlp`),
        createParamsPromise({ id: card.id })
      ),
      200
    )
    expect(pay.tag).toBe('payRequest')
    expect(pay.callback).not.toContain('/api/lud16/')

    const cb: any = await assertResponse(
      await LnurlpCbGet(
        createNextRequest(pay.callback, { searchParams: { amount: '10000' } }),
        createParamsPromise({ id: card.id })
      ),
      200
    )
    expect(cb.pr).toBe('lnbc100n1cardtopup')
    expect(nwcCtorMock).toHaveBeenCalledWith({
      nostrWalletConnectUrl: PRIMARY_NWC_URI
    })
    expect(prismaMock.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          purpose: 'CARD_TOPUP',
          remoteWalletId: 'wallet-primary'
        })
      })
    )
  })

  it('tops up a receive-only card wallet', async () => {
    const card = receivableCard({
      remoteWallet: {
        ...CARD_WALLET,
        config: { ...CARD_WALLET.config, mode: 'RECEIVE' }
      }
    })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const pay: any = await assertResponse(
      await LnurlpGet(
        createNextRequest(`/api/cards/${card.id}/lnurlp`),
        createParamsPromise({ id: card.id })
      ),
      200
    )
    expect(pay.tag).toBe('payRequest')

    await assertResponse(
      await LnurlpCbGet(
        createNextRequest(pay.callback, { searchParams: { amount: '10000' } }),
        createParamsPromise({ id: card.id })
      ),
      200
    )
    expect(makeInvoiceMock).toHaveBeenCalled()
    expect(prismaMock.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ remoteWalletId: 'wallet-card' })
      })
    )
  })

  it.each([
    ['unpaired', { user: null }, 'Card is not paired'],
    [
      'blocked',
      { blockedAt: new Date('2026-01-02T00:00:00Z') },
      'Card is blocked'
    ],
    [
      'disabled',
      { disabledAt: new Date('2026-01-02T00:00:00Z') },
      'Card is disabled'
    ],
    [
      'no wallet',
      { remoteWallet: null, user: owner(null) },
      'Card is not configured to receive payments'
    ]
  ])('returns ERROR for a %s card', async (_label, overrides, reason) => {
    const card = receivableCard(overrides)
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const pay: any = await assertResponse(
      await LnurlpGet(
        createNextRequest(`/api/cards/${card.id}/lnurlp`),
        createParamsPromise({ id: card.id })
      ),
      200
    )
    expect(pay).toEqual({ status: 'ERROR', reason })

    const cb: any = await assertResponse(
      await LnurlpCbGet(
        createNextRequest(`/api/cards/${card.id}/lnurlp/cb`, {
          searchParams: { amount: '10000' }
        }),
        createParamsPromise({ id: card.id })
      ),
      200
    )
    expect(cb).toEqual({ status: 'ERROR', reason })
    expect(makeInvoiceMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the card does not exist', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)
    const res = await LnurlpGet(
      createNextRequest('/api/cards/missing/lnurlp'),
      createParamsPromise({ id: 'missing' })
    )
    expect(res.status).toBe(404)
  })

  it('rejects an amount outside the advertised range', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    const res = await LnurlpCbGet(
      createNextRequest(`/api/cards/${card.id}/lnurlp/cb`, {
        searchParams: { amount: '500' }
      }),
      createParamsPromise({ id: card.id })
    )
    const body: any = await assertResponse(res, 200)
    expect(body).toEqual({
      status: 'ERROR',
      reason: 'Amount is outside the allowed range'
    })
    expect(makeInvoiceMock).not.toHaveBeenCalled()
  })
})
