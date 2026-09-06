import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey
} from 'nostr-tools/pure'

// Deliberately NOT mocking nostr-tools: the point of this file is that the
// signature really is bound to the body, end to end with real crypto.
vi.mock('@/lib/public-url', () => ({
  resolveApiUrl: vi.fn().mockRejectedValue(new Error('settings unavailable'))
}))

import { validateNip98 } from '@/lib/nip98'

const URL_UNDER_TEST = 'http://localhost:3000/api/vouchers'
const secretKey = generateSecretKey()
const pubkey = getPublicKey(secretKey)

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => consoleErrorSpy.mockRestore())

/** Sign a NIP-98 token the way a well-behaved client would. */
function token(body: string | null, options: { payload?: boolean } = {}) {
  const tags: string[][] = [
    ['u', URL_UNDER_TEST],
    ['method', 'POST'],
    ['nonce', Math.random().toString(36).slice(2)]
  ]
  if (body !== null && options.payload !== false) {
    tags.push([
      'payload',
      createHash('sha256').update(body, 'utf8').digest('hex')
    ])
  }
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: ''
    },
    secretKey
  )
  return Buffer.from(JSON.stringify(event)).toString('base64')
}

function request(body: string | null, authToken: string) {
  return new Request(URL_UNDER_TEST, {
    method: 'POST',
    headers: {
      authorization: `Nostr ${authToken}`,
      host: 'localhost:3000',
      ...(body === null ? {} : { 'content-type': 'application/json' })
    },
    ...(body === null ? {} : { body })
  })
}

describe('NIP-98 payload binding', () => {
  it('accepts a request whose body matches the signed payload tag', async () => {
    const body = JSON.stringify({ npub: 'npub1abc', nonce: 'x' })
    const result = await validateNip98(request(body, token(body)))
    expect(result.pubkey).toBe(pubkey)
  })

  it('rejects a token replayed against a different body', async () => {
    // The whole point. nostr-tools only checks the payload tag when its
    // `body` argument is a non-empty *object*, and we hand it the raw string
    // — so before this binding existed, a captured Authorization header could
    // be reused within the ±60s window to submit anything at all under the
    // original signer. For POST /api/vouchers that means depositing to a
    // different recipient, past an allowlist that trusts the signer.
    const signed = JSON.stringify({ npub: 'npub1victim', nonce: 'x' })
    const swapped = JSON.stringify({ npub: 'npub1attacker', nonce: 'x' })

    await expect(
      validateNip98(request(swapped, token(signed)))
    ).rejects.toThrow(/payload tag does not match/)
  })

  it('rejects a body-bearing request with no payload tag at all', async () => {
    // Accepting the absence is the same as not checking.
    const body = JSON.stringify({ npub: 'npub1abc' })
    await expect(
      validateNip98(request(body, token(body, { payload: false })))
    ).rejects.toThrow(/payload tag is required/)
  })

  it('still accepts an empty-body request without a payload tag', async () => {
    const result = await validateNip98(request(null, token(null)))
    expect(result.pubkey).toBe(pubkey)
  })

  it('rejects a payload tag that does not match its own body', async () => {
    const body = JSON.stringify({ a: 1 })
    const tampered = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(token(body), 'base64').toString()),
        // Not re-signed, so this also proves the signature check runs first.
        tags: [['payload', 'deadbeef']]
      })
    ).toString('base64')

    await expect(validateNip98(request(body, tampered))).rejects.toThrow()
  })
})
