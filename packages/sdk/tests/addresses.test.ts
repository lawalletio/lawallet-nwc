import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { LaWalletClient, generateSigner } from '../src'
import { ENDPOINT } from './helpers'
import { server } from './setup'

const address = (overrides: Record<string, unknown> = {}) => ({
  username: 'alice',
  mode: 'IDLE',
  redirect: null,
  remoteWalletId: null,
  remoteWalletName: null,
  isPrimary: true,
  nwcMode: 'NONE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides
})

describe('addresses resource', () => {
  it('lists, updates and unwraps invoices', async () => {
    const { signer } = generateSigner()
    const client = new LaWalletClient({ endpoint: ENDPOINT, signer })

    let putBody: unknown = null
    server.use(
      http.get(`${ENDPOINT}/api/wallet/addresses`, () =>
        HttpResponse.json([address()])
      ),
      http.put(
        `${ENDPOINT}/api/wallet/addresses/alice`,
        async ({ request }) => {
          putBody = await request.json()
          return HttpResponse.json(
            address({ mode: 'CUSTOM_NWC', remoteWalletId: 'rw1' })
          )
        }
      ),
      http.get(`${ENDPOINT}/api/wallet/addresses/alice/invoices`, () =>
        HttpResponse.json({
          invoices: [{ id: 'inv1', status: 'PAID', amountSats: 21 }]
        })
      )
    )

    const list = await client.addresses.list()
    expect(list).toHaveLength(1)
    expect(list[0].username).toBe('alice')

    const updated = await client.addresses.update('alice', {
      mode: 'CUSTOM_NWC',
      remoteWalletId: 'rw1'
    })
    expect(putBody).toEqual({ mode: 'CUSTOM_NWC', remoteWalletId: 'rw1' })
    expect(updated.remoteWalletId).toBe('rw1')

    const invoices = await client.addresses.invoices('alice')
    expect(invoices[0].id).toBe('inv1')
  })

  it('unwraps the detail envelope from the single-address endpoint', async () => {
    const { signer } = generateSigner()
    const client = new LaWalletClient({ endpoint: ENDPOINT, signer })

    // The endpoint returns { address, wallets, ... }, not the bare DTO.
    server.use(
      http.get(`${ENDPOINT}/api/wallet/addresses/alice`, () =>
        HttpResponse.json({
          address: address({ mode: 'ALIAS', redirect: 'a@b.com' }),
          wallets: [],
          effectiveConnectionString: null,
          deferredProxyEnabled: false,
          protocols: {},
          isOwner: true,
          ownerPubkey: 'a'.repeat(64)
        })
      )
    )

    const result = await client.addresses.get('alice')
    expect(result.username).toBe('alice')
    expect(result.mode).toBe('ALIAS')

    const detail = await client.addresses.getDetail('alice')
    expect(detail.isOwner).toBe(true)
    expect(detail.address.username).toBe('alice')
  })

  it('checks availability without authentication', async () => {
    const client = new LaWalletClient({ endpoint: ENDPOINT })

    server.use(
      http.get(`${ENDPOINT}/api/lightning-addresses/check`, ({ request }) => {
        const username = new URL(request.url).searchParams.get('username')
        return HttpResponse.json({ available: username === 'free', username })
      })
    )

    await expect(client.addresses.checkAvailability('free')).resolves.toEqual({
      available: true,
      username: 'free'
    })
    await expect(client.addresses.checkAvailability('taken')).resolves.toEqual({
      available: false,
      username: 'taken'
    })
  })

  it('unwraps remote wallet scalar responses', async () => {
    const { signer } = generateSigner()
    const client = new LaWalletClient({ endpoint: ENDPOINT, signer })

    server.use(
      http.get(`${ENDPOINT}/api/remote-wallets/rw1/connection-string`, () =>
        HttpResponse.json({ connectionString: 'nostr+walletconnect://abc' })
      ),
      http.get(`${ENDPOINT}/api/remote-wallets/rw1/balance`, () =>
        HttpResponse.json({ balanceSats: 1234 })
      )
    )

    await expect(client.remoteWallets.connectionString('rw1')).resolves.toBe(
      'nostr+walletconnect://abc'
    )
    await expect(client.remoteWallets.balance('rw1')).resolves.toBe(1234)
  })
})
