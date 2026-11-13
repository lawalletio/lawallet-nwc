// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/tests/mocks/server'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ isTest: true, isDevelopment: false }))
}))

import { normalizeSwapStatus } from '@/lib/integrations/swap-provider'
import { matchFiatTransfer, wapuProvider } from '@/lib/integrations/wapu'
import {
  bullBitcoinProvider,
  findOrCreateRecipient
} from '@/lib/integrations/bullbitcoin'

const BB = 'https://api.bullbitcoin.com'
const WAPU = 'https://be-prod.wapu.app'
const CBU = '0000003100010000000001'

describe('normalizeSwapStatus', () => {
  it.each([
    ['Completed', 'COMPLETED'],
    ['executed', 'COMPLETED'],
    ['Canceled', 'FAILED'],
    ['expired', 'EXPIRED'],
    ['Pending', 'PENDING'],
    [null, 'PENDING']
  ])('%s → %s', (raw, expected) => {
    expect(normalizeSwapStatus(raw)).toBe(expected)
  })
})

describe('matchFiatTransfer (Wapu)', () => {
  const createdAt = new Date('2026-11-13T15:00:00Z') // 12:00 ART
  const tx = (
    id: string,
    amount: number,
    at: string,
    type = 'fiat_transfer'
  ) => ({
    transactionId: id,
    type,
    status: 'Pending',
    paymentAmount: amount,
    paymentCurrency: 'ARS',
    createdAt: at,
    receiptImageUrl: null,
    expiresAt: null
  })

  it('matches a known id directly', () => {
    const txs = [
      tx('a', 999, '2026-11-13 12:00:00'),
      tx('known', 1, '2020-01-01 00:00:00')
    ]
    expect(
      matchFiatTransfer(
        txs,
        { externalId: 'known', amountArs: 50_000, createdAt },
        new Set()
      )?.transactionId
    ).toBe('known')
  })

  it('correlates by amount and nearest time, skipping deposits and taken ids', () => {
    const txs = [
      tx('deposit', 50_000, '2026-11-13 12:00:01', 'deposit'),
      tx('taken', 50_000, '2026-11-13 12:00:02'),
      tx('far', 50_000, '2026-11-13 12:30:00'),
      tx('near', 50_010, '2026-11-13 12:00:30'),
      tx('wrong-amount', 60_000, '2026-11-13 12:00:00'),
      tx('too-early', 50_000, '2026-11-13 11:00:00')
    ]
    const match = matchFiatTransfer(
      txs,
      { externalId: 'dep-id', amountArs: 50_000, createdAt },
      new Set(['taken'])
    )
    expect(match?.transactionId).toBe('near')
  })

  it('returns null when nothing fits', () => {
    expect(
      matchFiatTransfer(
        [],
        { externalId: 'x', amountArs: 1, createdAt },
        new Set()
      )
    ).toBeNull()
  })
})

describe('Wapu quote', () => {
  it('folds the transfer fee and the off-ramp premium into the rate', async () => {
    server.use(
      http.post(`${WAPU}/transactions/tentative-amount`, () =>
        HttpResponse.json({
          exchange_rate: 100_000_000,
          fee: 4,
          usdt_amount: 1000
        })
      )
    )
    const q = await wapuProvider('k').quote(10_000)
    expect(q.arsPerBtc).toBeCloseTo(100_000_000 / 1.004 / 1.015, 6)
    expect(q.minArs).toBe(10_000)
    expect(q.sats).toBe(Math.ceil((10_000 / q.arsPerBtc) * 1e8))
  })

  it('reports the CloudFront IP block clearly', async () => {
    server.use(
      http.post(
        `${WAPU}/transactions/tentative-amount`,
        () =>
          new HttpResponse('<html>blocked</html>', {
            status: 403,
            headers: { 'x-cache': 'Error from cloudfront' }
          })
      )
    )
    await expect(wapuProvider('k').quote(10_000)).rejects.toThrow(/firewall/)
  })
})

describe('Wapu status (order deposit)', () => {
  const swap = {
    externalId: 'dep-1',
    amountArs: 50_000,
    createdAt: new Date('2026-11-13T04:49:59Z')
  }
  const deposit = (status: string, expires_at: string | null = null) =>
    server.use(
      http.get(`${WAPU}/transactions/my_transactions`, () =>
        HttpResponse.json([
          {
            transaction_id: 'dep-1',
            type: 'deposit',
            status,
            payment_amount: 30.62,
            payment_currency: 'USDT',
            created_at: '2026-11-13 01:49:59',
            expires_at
          }
        ])
      )
    )

  it('reports paid once Wapu has the sats, before any transfer exists', async () => {
    deposit('Completed')
    expect(await wapuProvider('k').status(swap)).toMatchObject({
      status: 'PENDING',
      paid: true
    })
  })

  it('carries Wapu’s own deadline (Argentina time)', async () => {
    deposit('Pending', '2026-11-13 02:19:59')
    const s = await wapuProvider('k').status(swap)
    expect(s).toMatchObject({ status: 'PENDING' })
    expect(s.expiresAt?.toISOString()).toBe('2026-11-13T05:19:59.000Z')
  })

  it('expires an unpaid deposit Wapu dropped', async () => {
    deposit('Canceled')
    expect(await wapuProvider('k').status(swap)).toMatchObject({
      status: 'EXPIRED',
      providerStatus: 'Canceled'
    })
  })
})

describe('Bull Bitcoin', () => {
  it('reuses an existing recipient with the same CBU', async () => {
    const methods: string[] = []
    server.use(
      http.post(`${BB}/ak/api-recipients`, async ({ request }) => {
        const body = (await request.json()) as { method: string }
        methods.push(body.method)
        return HttpResponse.json({
          result: { elements: [{ recipientId: 'r1', claveUniform: CBU }] }
        })
      })
    )
    expect(await findOrCreateRecipient('k', CBU, 'Ana')).toBe('r1')
    expect(methods).toEqual(['listRecipientsFiat'])
  })

  it('recovers from a concurrent duplicate (ERR_RCP_409)', async () => {
    let lists = 0
    server.use(
      http.post(`${BB}/ak/api-recipients`, async ({ request }) => {
        const body = (await request.json()) as { method: string }
        if (body.method === 'createRecipientFiat') {
          return HttpResponse.json({
            error: {
              message: '409',
              data: { apiError: { code: 'ERR_RCP_409' } }
            }
          })
        }
        lists += 1
        return HttpResponse.json({
          result: {
            elements:
              lists > 1 ? [{ recipientId: 'r2', claveUniform: CBU }] : []
          }
        })
      })
    )
    expect(await findOrCreateRecipient('k', CBU, 'Ana')).toBe('r2')
  })

  it('sells to a CBU and converts the BTC pay-in to sats', async () => {
    let sentKey: string | null = null
    server.use(
      http.post(`${BB}/ak/api-recipients`, () =>
        HttpResponse.json({
          result: { elements: [{ recipientId: 'r1', claveUniform: CBU }] }
        })
      ),
      http.post(`${BB}/ak/api-orders`, ({ request }) => {
        sentKey = request.headers.get('x-api-key')
        return HttpResponse.json({
          result: {
            element: {
              orderId: 'o1',
              lightningInvoice: 'lnbc1',
              payinAmount: 0.00012345,
              payinCurrency: 'BTC',
              orderStatus: 'Pending'
            }
          }
        })
      })
    )
    const order = await bullBitcoinProvider('secret-key').createSell({
      amountArs: 20_000,
      destination: CBU,
      holderName: 'Ana'
    })
    expect(sentKey).toBe('secret-key')
    expect(order).toMatchObject({
      externalId: 'o1',
      bolt11: 'lnbc1',
      amountSats: 12_345
    })
  })

  it('refuses an alias (needs a CBU/CVU)', async () => {
    await expect(
      bullBitcoinProvider('k').createSell({
        amountArs: 1,
        destination: 'mi.alias'
      })
    ).rejects.toThrow(/CBU/)
  })

  it('surfaces min/max limits as a validation error', async () => {
    server.use(
      http.post(`${BB}/ak/api-orders`, () =>
        HttpResponse.json({
          error: {
            message: 'limit',
            data: {
              reason: {
                limit: {
                  amount: 5000,
                  currencyCode: 'ARS',
                  conditionalOperator: 'GREATER_THAN_OR_EQUAL'
                }
              }
            }
          }
        })
      ),
      http.post(`${BB}/ak/api-recipients`, () =>
        HttpResponse.json({
          result: { elements: [{ recipientId: 'r1', claveUniform: CBU }] }
        })
      )
    )
    await expect(
      bullBitcoinProvider('k').createSell({ amountArs: 1, destination: CBU })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringMatching(/minimum amount is 5000 ARS/)
    })
  })
})
