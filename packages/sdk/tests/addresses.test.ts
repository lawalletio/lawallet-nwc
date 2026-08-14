import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { LaWalletClient, LaWalletError, generateSigner, toPubkey } from '../src'
import { ENDPOINT, decodeNip98Header, expectValidNip98 } from './helpers'
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

describe('operator provisioning', () => {
  const TARGET = 'b'.repeat(64)

  it('provisions an address for another pubkey with a signed request', async () => {
    const { signer } = generateSigner()
    const client = new LaWalletClient({ endpoint: ENDPOINT, signer })

    let body: unknown = null
    let authHeader: string | null = null
    server.use(
      http.post(`${ENDPOINT}/api/lightning-addresses`, async ({ request }) => {
        authHeader = request.headers.get('authorization')
        body = await request.json()
        return HttpResponse.json(
          { ...address({ username: 'reserved' }), pubkey: TARGET },
          { status: 201 }
        )
      })
    )

    const result = await client.addresses.provision({
      username: 'reserved',
      pubkey: TARGET
    })

    expect(body).toEqual({ username: 'reserved', pubkey: TARGET })
    expectValidNip98(
      decodeNip98Header(authHeader),
      `${ENDPOINT}/api/lightning-addresses`,
      'POST'
    )
    expect(result.pubkey).toBe(TARGET)
    expect(result.username).toBe('reserved')
  })

  it('normalises an npub to hex for the API', () => {
    const { npub, pubkey } = generateSigner()
    expect(toPubkey(npub)).toBe(pubkey)
    expect(toPubkey(pubkey.toUpperCase())).toBe(pubkey)
    expect(() => toPubkey('not-a-key')).toThrow()
  })
})

describe('auth.mintJwt', () => {
  it('mints a session token with a NIP-98 signature', async () => {
    const { signer } = generateSigner()
    const client = new LaWalletClient({ endpoint: ENDPOINT, signer })

    let authHeader: string | null = null
    let body: unknown = null
    server.use(
      http.post(`${ENDPOINT}/api/jwt`, async ({ request }) => {
        authHeader = request.headers.get('authorization')
        body = await request.json()
        return HttpResponse.json({
          token: 'a.b.c',
          expiresIn: '12h',
          type: 'Bearer'
        })
      })
    )

    const minted = await client.auth.mintJwt('12h')

    expect(body).toEqual({ expiresIn: '12h' })
    expectValidNip98(
      decodeNip98Header(authHeader),
      `${ENDPOINT}/api/jwt`,
      'POST'
    )
    expect(minted.token).toBe('a.b.c')

    // The minted token can then carry the session — but the signer wins while
    // it is still set, so it has to be cleared first.
    client.setSigner(null)
    client.setToken(minted.token)
    server.use(
      http.get(`${ENDPOINT}/api/users/me`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer a.b.c')
        return HttpResponse.json({ userId: 'u1' })
      })
    )
    await client.users.me()
  })

  it('refuses without a signer, since /api/jwt only accepts NIP-98', async () => {
    const client = new LaWalletClient({ endpoint: ENDPOINT, token: 'a.b.c' })

    const error = await client.auth.mintJwt().catch(e => e)
    expect(error).toBeInstanceOf(LaWalletError)
    expect(error.code).toBe('NO_SIGNER')
  })
})
