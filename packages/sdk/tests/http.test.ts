import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { LaWalletClient, LaWalletError, generateSigner } from '../src'
import { ENDPOINT } from './helpers'
import { server } from './setup'

describe('http error handling', () => {
  it('surfaces the API error envelope as a typed LaWalletError', async () => {
    const { signer } = generateSigner()
    const client = new LaWalletClient({ endpoint: ENDPOINT, signer })

    server.use(
      http.get(`${ENDPOINT}/api/users/me`, () =>
        HttpResponse.json(
          {
            error: {
              message: 'Payment required',
              code: 'PAYMENT_REQUIRED',
              details: { amountSats: 21 }
            }
          },
          { status: 402 }
        )
      )
    )

    const error = await client.users.me().catch(e => e)
    expect(error).toBeInstanceOf(LaWalletError)
    expect(error.status).toBe(402)
    expect(error.code).toBe('PAYMENT_REQUIRED')
    expect(error.message).toBe('Payment required')
    expect(error.details).toEqual({ amountSats: 21 })
  })

  it('rejects authenticated calls locally when no signer or token is set', async () => {
    const client = new LaWalletClient({ endpoint: ENDPOINT })

    const error = await client.users.me().catch(e => e)
    expect(error).toBeInstanceOf(LaWalletError)
    expect(error.status).toBe(401)
    expect(error.code).toBe('NO_SIGNER')
  })

  it('fires onUnauthorized on 401 responses', async () => {
    const { signer } = generateSigner()
    const onUnauthorized = vi.fn()
    const client = new LaWalletClient({
      endpoint: ENDPOINT,
      signer,
      onUnauthorized
    })

    server.use(
      http.get(`${ENDPOINT}/api/users/me`, () =>
        HttpResponse.json(
          { error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } },
          { status: 401 }
        )
      )
    )

    await expect(client.users.me()).rejects.toThrow('Unauthorized')
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('returns undefined for empty bodies', async () => {
    const { signer } = generateSigner()
    const client = new LaWalletClient({ endpoint: ENDPOINT, signer })

    server.use(
      http.delete(
        `${ENDPOINT}/api/wallet/addresses/alice`,
        () => new HttpResponse(null, { status: 204 })
      )
    )

    await expect(client.addresses.remove('alice')).resolves.toBeUndefined()
  })

  it('rejects endpoints that are not absolute http(s) URLs', () => {
    expect(() => new LaWalletClient({ endpoint: 'instance.test' })).toThrow(
      /absolute public URL/
    )
  })
})
