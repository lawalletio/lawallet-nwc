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

import { decode } from 'light-bolt11-decoder'
import { GET as ScanGet } from '@/app/api/cards/[id]/scan/route'
import {
  GET as LnurlpGet,
  OPTIONS as LnurlpOptions
} from '@/app/api/cards/[id]/lnurlp/route'
import {
  GET as LnurlpCbGet,
  OPTIONS as LnurlpCbOptions
} from '@/app/api/cards/[id]/lnurlp/cb/route'
import { getConfig } from '@/lib/config'
import { getSettings } from '@/lib/settings'
import { logger } from '@/lib/logger'
import { closeAllServerNwcClients } from '@/lib/wallet/drivers/nwc-client-cache'
import { nwcDriver } from '@/lib/wallet/drivers'
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

type ReceivableWallet = {
  id?: string
  type: 'NWC'
  config: {
    connectionString: string
    mode: 'RECEIVE' | 'SEND_RECEIVE'
  }
  status: 'ACTIVE'
}

function defaultConfig() {
  return {
    maintenance: { enabled: false },
    nwcVault: {
      secret: 'test-card-lnurlp-vault-secret-0123456789abcd',
      enabled: true
    }
  }
}

function decodedBolt11(paymentHash?: string) {
  const sections: { name: string; value: number | string }[] = [
    { name: 'timestamp', value: 1_700_000_000 },
    { name: 'expiry', value: 600 }
  ]
  if (paymentHash) {
    sections.push({ name: 'payment_hash', value: paymentHash })
  }
  return { sections }
}

function receivableCard(
  overrides: {
    remoteWallet?: ReceivableWallet | null
    user?: ReturnType<typeof owner> | null
    blockedAt?: Date | null
    disabledAt?: Date | null
    userId?: string | null
  } = {}
) {
  return {
    ...createCardFixture(),
    userId: overrides.userId === undefined ? 'user-1' : overrides.userId,
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
  vi.mocked(getConfig).mockReturnValue(defaultConfig() as any)
  vi.mocked(decode).mockReturnValue(decodedBolt11('ab'.repeat(32)) as any)
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

  it('rejects an amount above the advertised maximum', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    const body: any = await assertResponse(
      await callback(card.id, { amount: '1000000001' }),
      200
    )
    expect(body).toEqual({
      status: 'ERROR',
      reason: 'Amount is outside the allowed range'
    })
    expect(makeInvoiceMock).not.toHaveBeenCalled()
  })

  it.each([
    ['zero', '0'],
    ['a leading zero', '01000'],
    ['a fractional amount', '1000.5'],
    ['an unsafe integer', '9'.repeat(16)]
  ])('rejects %s as an invalid amount', async (_label, amount) => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    const body: any = await assertResponse(
      await callback(card.id, { amount }),
      200
    )
    expect(body).toEqual({ status: 'ERROR', reason: 'Invalid payment amount' })
    expect(makeInvoiceMock).not.toHaveBeenCalled()
  })

  it('strips control characters from a payer comment', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    const body: any = await assertResponse(
      await callback(card.id, { amount: '10000', comment: '  top\nup\x7f ' }),
      200
    )
    expect(body.pr).toBe('lnbc100n1cardtopup')
    expect(makeInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'BoltCard top-up: topup' })
    )
    expect(prismaMock.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          description: 'BoltCard top-up: topup',
          metadata: { cardId: card.id, comment: 'topup' }
        })
      })
    )
  })

  it('drops a comment that is only whitespace', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    await assertResponse(
      await callback(card.id, { amount: '10000', comment: '  \n  ' }),
      200
    )
    expect(makeInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'BoltCard top-up' })
    )
    const create = vi.mocked(prismaMock.invoice.upsert).mock.calls[0][0].create
    expect(create.metadata).toEqual({ cardId: card.id })
    expect(create.description).toBe('BoltCard top-up')
  })

  it('stores a top-up when the wallet has no id and the card has no userId', async () => {
    const card = receivableCard({
      userId: null,
      remoteWallet: {
        type: 'NWC',
        config: {
          connectionString: CARD_NWC_URI,
          mode: 'SEND_RECEIVE'
        },
        status: 'ACTIVE'
      }
    })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    const body: any = await assertResponse(
      await callback(card.id, { amount: '10000' }),
      200
    )
    expect(body.pr).toBe('lnbc100n1cardtopup')
    const saved = vi.mocked(prismaMock.invoice.upsert).mock.calls[0][0]
    expect(saved.create.userId).toBeUndefined()
    expect(saved.create.remoteWalletId).toBeUndefined()
    expect(saved.update.remoteWalletId).toBeUndefined()
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        cardId: card.id,
        remoteWalletId: null,
        hasComment: false
      }),
      'Card LNURL-pay invoice created'
    )
  })

  it('returns 404 from the callback when the card does not exist', async () => {
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(null)
    const res = await callback('missing', { amount: '10000' })
    expect(res.status).toBe(404)
    expect((await res.json()) as any).toMatchObject({
      error: { message: 'Card not found' }
    })
    expect(makeInvoiceMock).not.toHaveBeenCalled()
  })

  it('returns 503 when the bound wallet vault config cannot be decrypted', async () => {
    const card = receivableCard({
      remoteWallet: {
        ...CARD_WALLET,
        config: {
          connectionString: 'lwrw1:not-a-valid-envelope',
          mode: 'SEND_RECEIVE'
        }
      }
    })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)

    const pay = await payRequest(card.id)
    expect(pay.status).toBe(503)
    expect(await errorMessage(pay)).toBe('Wallet is currently unavailable')
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: card.id }),
      'Card LNURL-pay wallet route resolution failed'
    )

    const cb = await callback(card.id, { amount: '10000' })
    expect(cb.status).toBe(503)
    expect(await errorMessage(cb)).toBe('Wallet is currently unavailable')
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: card.id }),
      'Card LNURL-pay callback wallet route resolution failed'
    )
    expect(makeInvoiceMock).not.toHaveBeenCalled()
  })

  it('does not map non-driver route errors to a 503', async () => {
    const card = receivableCard({
      remoteWallet: {
        ...CARD_WALLET,
        config: {
          connectionString: 'lwrw1:not-a-valid-envelope',
          mode: 'SEND_RECEIVE'
        }
      }
    })
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(getConfig).mockReturnValue({
      maintenance: { enabled: false },
      nwcVault: { secret: '', enabled: false }
    } as any)

    const pay = await payRequest(card.id)
    expect(pay.status).toBe(500)
    expect(await errorMessage(pay)).toBe('Internal server error')

    const cb = await callback(card.id, { amount: '10000' })
    expect(cb.status).toBe(500)
    expect(await errorMessage(cb)).toBe('Internal server error')
    expect(makeInvoiceMock).not.toHaveBeenCalled()
  })

  it('returns 503 when the wallet driver fails to mint', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    makeInvoiceMock.mockRejectedValueOnce(new Error('relay timeout'))

    const res = await callback(card.id, { amount: '10000' })
    expect(res.status).toBe(503)
    expect(await errorMessage(res)).toBe('Wallet is currently unavailable')
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: card.id, walletType: 'NWC' }),
      'Card LNURL-pay invoice mint failed'
    )
    expect(prismaMock.invoice.upsert).not.toHaveBeenCalled()
  })

  it('does not map non-driver mint failures to a 503', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    const original = nwcDriver.makeInvoice
    nwcDriver.makeInvoice = (async () => {
      throw new Error('unexpected mint failure')
    }) as typeof nwcDriver.makeInvoice
    try {
      const res = await callback(card.id, { amount: '10000' })
      expect(res.status).toBe(500)
      expect(await errorMessage(res)).toBe('Internal server error')
      expect(prismaMock.invoice.upsert).not.toHaveBeenCalled()
    } finally {
      nwcDriver.makeInvoice = original
    }
  })

  it('returns 500 when the wallet returns an empty invoice', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    makeInvoiceMock.mockResolvedValueOnce({
      invoice: '',
      payment_hash: 'ab'.repeat(32),
      amount: 10_000,
      expires_at: 1_700_000_600
    })
    const res = await callback(card.id, { amount: '10000' })
    expect(res.status).toBe(500)
    expect(await errorMessage(res)).toBe('Failed to generate invoice')
    expect(prismaMock.invoice.upsert).not.toHaveBeenCalled()
  })

  it('returns 503 when the minted invoice amount does not match', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    makeInvoiceMock.mockResolvedValueOnce({
      invoice: 'lnbc100n1cardtopup',
      payment_hash: 'ab'.repeat(32),
      amount: 9_999,
      expires_at: 1_700_000_600
    })
    const res = await callback(card.id, { amount: '10000' })
    expect(res.status).toBe(503)
    expect(await errorMessage(res)).toBe(
      'Wallet returned an invoice with the wrong amount'
    )
    expect(prismaMock.invoice.upsert).not.toHaveBeenCalled()
  })

  it('accepts an invoice that does not echo the requested amount', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    makeInvoiceMock.mockResolvedValueOnce({
      invoice: 'lnbc100n1cardtopup',
      payment_hash: 'ab'.repeat(32),
      expires_at: 1_700_000_600
    })
    const body: any = await assertResponse(
      await callback(card.id, { amount: '10000' }),
      200
    )
    expect(body.pr).toBe('lnbc100n1cardtopup')
    expect(prismaMock.invoice.upsert).toHaveBeenCalled()
  })

  it('falls back to the bolt11 payment hash when the wallet omits one', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    const decodedHash = 'cd'.repeat(32)
    vi.mocked(decode).mockReturnValue(decodedBolt11(decodedHash) as any)
    makeInvoiceMock.mockResolvedValueOnce({
      invoice: 'lnbc100n1cardtopup',
      payment_hash: '',
      amount: 10_000,
      expires_at: 1_700_000_600
    })
    await assertResponse(await callback(card.id, { amount: '10000' }), 200)
    expect(prismaMock.invoice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { paymentHash: decodedHash },
        create: expect.objectContaining({ paymentHash: decodedHash })
      })
    )
  })

  it('returns 500 when the invoice has no payment hash', async () => {
    const card = receivableCard()
    vi.mocked(prismaMock.card.findUnique).mockResolvedValue(card as any)
    vi.mocked(decode).mockReturnValue(decodedBolt11() as any)
    makeInvoiceMock.mockResolvedValueOnce({
      invoice: 'lnbc100n1cardtopup',
      payment_hash: '',
      amount: 10_000,
      expires_at: 1_700_000_600
    })
    const res = await callback(card.id, { amount: '10000' })
    expect(res.status).toBe(500)
    expect(await errorMessage(res)).toBe('Invalid invoice returned from wallet')
    expect(logger.error).toHaveBeenCalledWith(
      { cardId: card.id },
      'Failed to extract payment hash from bolt11'
    )
    expect(prismaMock.invoice.upsert).not.toHaveBeenCalled()
  })
})

function payRequest(cardId: string) {
  return LnurlpGet(
    createNextRequest(`/api/cards/${cardId}/lnurlp`),
    createParamsPromise({ id: cardId })
  )
}

function callback(cardId: string, searchParams: Record<string, string>) {
  return LnurlpCbGet(
    createNextRequest(`/api/cards/${cardId}/lnurlp/cb`, { searchParams }),
    createParamsPromise({ id: cardId })
  )
}

async function errorMessage(res: Response) {
  const body = (await res.json()) as { error: { message: string } }
  return body.error.message
}
