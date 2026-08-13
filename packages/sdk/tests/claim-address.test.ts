import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { LaWalletClient, LaWalletError, generateSigner } from '../src'
import { ENDPOINT } from './helpers'
import { server } from './setup'

const PREIMAGE = 'ab'.repeat(32)

function makeClient() {
  const { signer } = generateSigner()
  return new LaWalletClient({ endpoint: ENDPOINT, signer })
}

const invoiceResponse = {
  success: true,
  message: 'Pay to claim',
  id: 'inv1',
  bolt11: 'lnbc210n1...',
  paymentHash: 'f'.repeat(64),
  amountSats: 21,
  verify: `${ENDPOINT}/api/lud16/operator/verify/${'f'.repeat(64)}`,
  expiresAt: new Date(Date.now() + 60_000).toISOString()
}

describe('registration.claimAddress', () => {
  it('resolves immediately on the free path', async () => {
    const client = makeClient()

    server.use(
      http.post(`${ENDPOINT}/api/wallet/addresses`, () =>
        HttpResponse.json({ username: 'alice', mode: 'IDLE' })
      ),
      http.get(`${ENDPOINT}/api/settings`, () =>
        HttpResponse.json({ domain: 'instance.test' })
      )
    )

    await expect(
      client.registration.claimAddress({ username: 'alice' })
    ).resolves.toEqual({ lightningAddress: 'alice@instance.test', paid: false })
  })

  it('runs the paid path: 402 → invoice → LUD-21 settle → claim', async () => {
    const client = makeClient()
    const onInvoice = vi.fn()
    let verifyCalls = 0
    let claimBody: unknown = null

    server.use(
      http.post(`${ENDPOINT}/api/wallet/addresses`, () =>
        HttpResponse.json(
          { error: { message: 'Payment required', code: 'PAYMENT_REQUIRED' } },
          { status: 402 }
        )
      ),
      http.post(`${ENDPOINT}/api/invoices`, () =>
        HttpResponse.json(invoiceResponse)
      ),
      http.get(invoiceResponse.verify, () => {
        verifyCalls += 1
        return verifyCalls < 2
          ? HttpResponse.json({ settled: false })
          : HttpResponse.json({ settled: true, preimage: PREIMAGE })
      }),
      http.post(`${ENDPOINT}/api/invoices/inv1/claim`, async ({ request }) => {
        claimBody = await request.json()
        return HttpResponse.json({
          success: true,
          lightningAddress: 'alice@instance.test'
        })
      })
    )

    const result = await client.registration.claimAddress({
      username: 'alice',
      onInvoice,
      pollIntervalMs: 5
    })

    expect(onInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ bolt11: invoiceResponse.bolt11 })
    )
    expect(verifyCalls).toBe(2)
    expect(claimBody).toEqual({ preimage: PREIMAGE })
    expect(result).toEqual({
      lightningAddress: 'alice@instance.test',
      paid: true
    })
  })

  it('treats an already-claimed invoice as success', async () => {
    const client = makeClient()

    server.use(
      http.post(`${ENDPOINT}/api/wallet/addresses`, () =>
        HttpResponse.json(
          { error: { message: 'Payment required', code: 'PAYMENT_REQUIRED' } },
          { status: 402 }
        )
      ),
      http.post(`${ENDPOINT}/api/invoices`, () =>
        HttpResponse.json(invoiceResponse)
      ),
      http.get(invoiceResponse.verify, () =>
        HttpResponse.json({ settled: true, preimage: PREIMAGE })
      ),
      http.post(`${ENDPOINT}/api/invoices/inv1/claim`, () =>
        HttpResponse.json(
          {
            error: {
              message: 'This invoice has already been claimed',
              code: 'CONFLICT'
            }
          },
          { status: 409 }
        )
      ),
      http.get(`${ENDPOINT}/api/settings`, () =>
        HttpResponse.json({ domain: 'instance.test' })
      )
    )

    await expect(
      client.registration.claimAddress({ username: 'alice', pollIntervalMs: 5 })
    ).resolves.toEqual({ lightningAddress: 'alice@instance.test', paid: true })
  })

  it('surfaces half-configured paid mode as a typed error', async () => {
    const client = makeClient()

    server.use(
      http.post(`${ENDPOINT}/api/wallet/addresses`, () =>
        HttpResponse.json(
          { error: { message: 'Payment required', code: 'PAYMENT_REQUIRED' } },
          { status: 402 }
        )
      ),
      http.post(`${ENDPOINT}/api/invoices`, () =>
        HttpResponse.json({ free: true })
      )
    )

    const error = await client.registration
      .claimAddress({ username: 'alice' })
      .catch(e => e)
    expect(error).toBeInstanceOf(LaWalletError)
    expect(error.code).toBe('PAID_REGISTRATION_INCOMPLETE')
  })

  it('rethrows non-402 create failures untouched', async () => {
    const client = makeClient()

    server.use(
      http.post(`${ENDPOINT}/api/wallet/addresses`, () =>
        HttpResponse.json(
          { error: { message: 'Username is taken', code: 'CONFLICT' } },
          { status: 409 }
        )
      )
    )

    const error = await client.registration
      .claimAddress({ username: 'alice' })
      .catch(e => e)
    expect(error).toBeInstanceOf(LaWalletError)
    expect(error.status).toBe(409)
  })
})
