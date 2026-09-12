import { describe, expect, it, vi } from 'vitest'
import { bodyToPayload, createNip98Token } from '@/lib/nip98-client'
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

// ── Regression: NIP-98 auto-signed "Try it out" must not drop the body ─────
// Reproduces the bug introduced in 1904b22d: when Scalar's browser "Try it
// out" calls `fetch(new Request(url, {method, headers, body}))`, the
// interceptor's `normalizeRequest` returned `realBody: undefined` for
// `Request` inputs, so the re-issued request carried no body and the
// server's `validateBody` (`await request.json()`) threw `SyntaxError` →
// HTTP 500. The fix materialises the body once via `input.clone().text()`.

describe('regression: body drop on Request inputs', () => {
  const SCALAR_BODY = JSON.stringify({ id: 'card-1', designId: 'design-1' })

  function scalarRequest(): Request {
    // Mirrors `buildSafeBodyRequest` from @scalar/helpers: the browser
    // branch wraps every POST/PUT/PATCH in `new Request(url, {..., body})`.
    return new Request('http://localhost:3000/api/cards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: SCALAR_BODY
    })
  }

  it('delivers the original JSON body to a downstream handler', async () => {
    const req = await normalizeRequest(scalarRequest())
    // The interceptor re-issues a fresh request with the normalized body,
    // exactly as `api-docs-client.tsx` does inside the patched `fetch`.
    const downstream = new Request(req!.url, {
      method: req!.method,
      headers: req!.headers,
      body: req!.realBody
    })
    // `validateBody` calls `request.json()` — must not throw and must
    // return the object the user typed into Scalar.
    const parsed = await downstream.json()
    expect(parsed).toEqual({ id: 'card-1', designId: 'design-1' })
    expect(req!.bodyForHash).toBe(SCALAR_BODY)
    expect(bodyToPayload(req!.bodyForHash)).toEqual({
      id: 'card-1',
      designId: 'design-1'
    })
  })
})

describe('interceptor end-to-end (patched window.fetch)', () => {
  const SCALAR_BODY = JSON.stringify({ id: 'card-1', designId: 'design-1' })

  function makeIntercept(
    originalFetch: (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => Promise<Response>,
    nip98Routes: Set<string>,
    signer: {
      signEvent: (
        e: Record<string, unknown>
      ) => Promise<Record<string, unknown>>
    }
  ) {
    return async (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      try {
        const req = await normalizeRequest(input, init)
        if (req && shouldAutoSign(req, nip98Routes)) {
          const signed = await createNip98Token(
            req.url,
            { method: req.method, body: req.bodyForHash },
            signer as never
          )
          req.headers.set('Authorization', signed)
          return originalFetch(req.url, {
            method: req.method,
            headers: req.headers,
            body: req.realBody
          })
        }
      } catch {
        // fall through
      }
      return originalFetch(input as RequestInfo, init)
    }
  }

  it('re-issues the original JSON body to the downstream fetch for a NIP-98 route', async () => {
    let capturedInit: RequestInit | undefined
    const originalFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedInit = init
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
      }
    )
    const signer = {
      signEvent: vi.fn(async (e: Record<string, unknown>) => ({
        ...e,
        id: 'fake-id',
        sig: 'fake-sig'
      }))
    }
    const intercept = makeIntercept(
      originalFetch,
      new Set(['POST /api/cards']),
      signer
    )

    await intercept(
      new Request('http://localhost:3000/api/cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: SCALAR_BODY
      })
    )

    // Body reached the downstream fetch intact.
    expect(capturedInit!.body).toBe(SCALAR_BODY)
    // Auto-sign path was taken.
    expect(signer.signEvent).toHaveBeenCalled()
    // A Nostr token (not the Bearer jwt) is attached.
    const auth = new Headers(capturedInit!.headers as HeadersInit).get(
      'authorization'
    )
    expect(auth).toMatch(/^Nostr /)
    // A downstream handler could parse the body.
    const downstream = new Request('http://localhost:3000/api/cards', {
      method: 'POST',
      headers: new Headers(capturedInit!.headers as HeadersInit),
      body: capturedInit!.body
    })
    await expect(downstream.json()).resolves.toEqual({
      id: 'card-1',
      designId: 'design-1'
    })
  })

  it('does not sign or alter a non-NIP-98 route', async () => {
    const originalFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) =>
        new Response('{}', { status: 200 })
    )
    const signer = {
      signEvent: vi.fn(async (e: Record<string, unknown>) => ({
        ...e,
        id: 'fake-id',
        sig: 'fake-sig'
      }))
    }
    const intercept = makeIntercept(
      originalFetch,
      new Set(['POST /api/cards']),
      signer
    )

    await intercept('http://localhost:3000/api/health', { method: 'GET' })

    expect(signer.signEvent).not.toHaveBeenCalled()
    expect(originalFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/health',
      {
        method: 'GET'
      }
    )
  })
})
