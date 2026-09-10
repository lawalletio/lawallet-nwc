import { describe, expect, it } from 'vitest'
import { bodyToPayload } from '@/lib/nip98-client'
import {
  normalizeRequest,
  shouldAutoSign
} from '@/app/api-docs/normalize-request'

const JSON_BODY = '{"username":"alice","role":"USER"}'

function jsonRequest(url = 'http://localhost:3000/api/users') {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer jwt-from-scalar'
    },
    body: JSON_BODY
  })
}

describe('normalizeRequest', () => {
  it('preserves a JSON body when Scalar passes a Request (no init)', async () => {
    const input = jsonRequest()
    const req = await normalizeRequest(input)

    expect(req).not.toBeNull()
    expect(req!.url).toBe('http://localhost:3000/api/users')
    expect(req!.method).toBe('POST')
    expect(req!.headers.get('content-type')).toBe('application/json')
    expect(req!.realBody).toBe(JSON_BODY)
    expect(req!.bodyForHash).toBe(JSON_BODY)
    expect(bodyToPayload(req!.bodyForHash)).toEqual({
      username: 'alice',
      role: 'USER'
    })
  })

  it('does not consume the original Request body', async () => {
    const input = jsonRequest()
    await normalizeRequest(input)
    await expect(input.text()).resolves.toBe(JSON_BODY)
  })

  it('treats an empty Request body as missing (GET)', async () => {
    const input = new Request('http://localhost:3000/api/users')
    const req = await normalizeRequest(input)

    expect(req!.method).toBe('GET')
    expect(req!.realBody).toBeNull()
    expect(req!.bodyForHash).toBeUndefined()
    expect(bodyToPayload(req!.bodyForHash)).toBeUndefined()
  })

  it('lets init.body override a Request body', async () => {
    const input = jsonRequest()
    const override = '{"username":"bob"}'
    const req = await normalizeRequest(input, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: override
    })

    expect(req!.method).toBe('PUT')
    expect(req!.realBody).toBe(override)
    expect(req!.bodyForHash).toBe(override)
    expect(bodyToPayload(req!.bodyForHash)).toEqual({ username: 'bob' })
  })

  it('passes a string URL + init body through unchanged', async () => {
    const req = await normalizeRequest('http://localhost:3000/api/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON_BODY
    })

    expect(req!.url).toBe('http://localhost:3000/api/users')
    expect(req!.method).toBe('POST')
    expect(req!.realBody).toBe(JSON_BODY)
    expect(req!.bodyForHash).toBe(JSON_BODY)
  })

  it('accepts a URL object with init', async () => {
    const req = await normalizeRequest(
      new URL('http://localhost:3000/api/cards'),
      { method: 'patch', body: JSON_BODY }
    )

    expect(req!.url).toBe('http://localhost:3000/api/cards')
    expect(req!.method).toBe('PATCH')
    expect(req!.realBody).toBe(JSON_BODY)
    expect(req!.bodyForHash).toBe(JSON_BODY)
  })
})

describe('shouldAutoSign', () => {
  it('matches an exact NIP-98 route', async () => {
    const req = await normalizeRequest(jsonRequest())
    expect(shouldAutoSign(req!, new Set(['POST /api/users']))).toBe(true)
  })

  it('matches parameterized paths', async () => {
    const req = await normalizeRequest(
      new Request('http://localhost:3000/api/cards/abc-123', {
        method: 'PUT',
        body: '{}'
      })
    )
    expect(shouldAutoSign(req!, new Set(['PUT /api/cards/{id}']))).toBe(true)
  })

  it('does not sign routes that are not in the NIP-98 set', async () => {
    const req = await normalizeRequest(jsonRequest())
    expect(shouldAutoSign(req!, new Set(['GET /api/users']))).toBe(false)
  })
})
