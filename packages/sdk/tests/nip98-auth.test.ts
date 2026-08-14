import { http, HttpResponse } from 'msw'
import { hashPayload } from 'nostr-tools/nip98'
import { describe, expect, it } from 'vitest'
import { LaWalletClient, generateSigner } from '../src'
import { ENDPOINT, decodeNip98Header, expectValidNip98, tag } from './helpers'
import { server } from './setup'

describe('per-request NIP-98 authentication', () => {
  it('signs every authenticated GET with a valid kind-27235 event', async () => {
    const { signer, pubkey } = generateSigner()
    const client = new LaWalletClient({ endpoint: ENDPOINT, signer })

    let authHeader: string | null = null
    server.use(
      http.get(`${ENDPOINT}/api/users/me`, ({ request }) => {
        authHeader = request.headers.get('authorization')
        return HttpResponse.json({ userId: 'u1', lightningAddress: null })
      })
    )

    await client.users.me()

    const event = decodeNip98Header(authHeader)
    expectValidNip98(event, `${ENDPOINT}/api/users/me`, 'GET')
    expect(event.pubkey).toBe(pubkey)
  })

  it('commits POST bodies via the payload hash tag', async () => {
    const { signer } = generateSigner()
    const client = new LaWalletClient({ endpoint: ENDPOINT, signer })

    let authHeader: string | null = null
    server.use(
      http.post(`${ENDPOINT}/api/wallet/addresses`, ({ request }) => {
        authHeader = request.headers.get('authorization')
        return HttpResponse.json({ username: 'alice' })
      })
    )

    await client.addresses.create({ username: 'alice' })

    const event = decodeNip98Header(authHeader)
    expectValidNip98(event, `${ENDPOINT}/api/wallet/addresses`, 'POST')
    expect(tag(event, 'payload')).toBe(hashPayload({ username: 'alice' }))
  })

  it('never signs public endpoints', async () => {
    const { signer } = generateSigner()
    const client = new LaWalletClient({ endpoint: ENDPOINT, signer })

    let authHeader: string | null = 'sentinel'
    server.use(
      http.get(`${ENDPOINT}/api/settings`, ({ request }) => {
        authHeader = request.headers.get('authorization')
        return HttpResponse.json({ domain: 'instance.test' })
      })
    )

    await client.settings.get()
    expect(authHeader).toBeNull()
  })

  it('prefers the signer over a configured Bearer token', async () => {
    const { signer } = generateSigner()
    const client = new LaWalletClient({
      endpoint: ENDPOINT,
      signer,
      token: 'device-jwt'
    })

    let authHeader: string | null = null
    server.use(
      http.get(`${ENDPOINT}/api/users/me`, ({ request }) => {
        authHeader = request.headers.get('authorization')
        return HttpResponse.json({ userId: 'u1' })
      })
    )

    await client.users.me()
    expect(authHeader).toMatch(/^Nostr /)
  })

  it('falls back to the Bearer token when no signer is set', async () => {
    const client = new LaWalletClient({
      endpoint: ENDPOINT,
      token: 'device-jwt'
    })

    let authHeader: string | null = null
    server.use(
      http.get(`${ENDPOINT}/api/users/me`, ({ request }) => {
        authHeader = request.headers.get('authorization')
        return HttpResponse.json({ userId: 'u1' })
      })
    )

    await client.users.me()
    expect(authHeader).toBe('Bearer device-jwt')
  })
})
