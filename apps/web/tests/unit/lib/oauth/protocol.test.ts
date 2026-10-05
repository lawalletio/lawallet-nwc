import { describe, it, expect } from 'vitest'
import {
  NotFoundError,
  ValidationError,
  ConflictError
} from '@/types/server/errors'
import { JsonParseError } from '@/lib/validation/middleware'
import { oauthRevokeRequestSchema } from '@/lib/validation/schemas'
import {
  OAuthError,
  oauthParams,
  parseOAuth,
  readOAuthBody,
  toAppError,
  withOAuthErrors
} from '@/lib/oauth/protocol'

describe('oauthParams', () => {
  it('drops parameters sent without a value (RFC 6749 §3.1)', () => {
    expect(oauthParams(new URLSearchParams('a=1&b=&c=3'))).toEqual({
      a: '1',
      c: '3'
    })
  })

  it('rejects a parameter sent twice, even when one copy is empty', () => {
    for (const query of ['a=1&a=2', 'a=&a=2']) {
      expect(() => oauthParams(new URLSearchParams(query))).toThrow(
        'Parameter "a" was sent more than once'
      )
    }
  })

  it('treats prototype-looking names as plain data', () => {
    const params = oauthParams(new URLSearchParams('__proto__=x&constructor=y'))
    expect(Object.getPrototypeOf(params)).toBe(Object.prototype)
    expect(params.constructor).toBe('y')
  })
})

describe('withOAuthErrors', () => {
  const run = (
    error: unknown,
    codeFor?: Parameters<typeof withOAuthErrors>[1]
  ) =>
    withOAuthErrors(async () => {
      throw error
    }, codeFor)()

  it('passes a successful response through', async () => {
    const response = new Response('ok')
    expect(await withOAuthErrors(async () => response)()).toBe(response)
  })

  it('answers an OAuthError in RFC 6749 shape, uncached', async () => {
    const res = await run(new OAuthError('invalid_grant', 'Code expired'))
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({
      error: 'invalid_grant',
      error_description: 'Code expired'
    })
  })

  it('turns a schema failure into invalid_request naming the field', async () => {
    const res = await run(
      new ValidationError('Invalid', [
        { path: ['redirect_uris', 0], message: 'Bad URI' }
      ])
    )
    expect(await res.json()).toEqual({
      error: 'invalid_request',
      error_description: 'redirect_uris.0: Bad URI'
    })
  })

  it('lets the route pick the code, and falls back to the message', async () => {
    const res = await run(new JsonParseError(), () => 'invalid_client_metadata')
    expect(await res.json()).toEqual({
      error: 'invalid_client_metadata',
      error_description: 'Malformed JSON in request body'
    })
    const pathless = await run(
      new ValidationError('Invalid', [{ path: [], message: 'Top level' }])
    )
    expect((await pathless.json()).error_description).toBe('Top level')
  })

  it('leaves other errors to withErrorHandling', async () => {
    const conflict = new ConflictError()
    await expect(run(conflict)).rejects.toBe(conflict)
  })
})

describe('toAppError', () => {
  it('maps an unknown client to 404 and other protocol errors to 400', () => {
    expect(() => toAppError(new OAuthError('invalid_client', 'x'))).toThrow(
      NotFoundError
    )
    expect(() => toAppError(new OAuthError('invalid_target', 'y'))).toThrow(
      ValidationError
    )
  })

  it('rethrows anything else untouched', () => {
    const boom = new Error('boom')
    expect(() => toAppError(boom)).toThrow(boom)
  })
})

describe('readOAuthBody + parseOAuth', () => {
  const post = (body: string, type?: string) =>
    new Request('https://example.org/api/oauth/revoke', {
      method: 'POST',
      body,
      headers: type ? { 'content-type': type } : {}
    })

  it('reads form bodies, with or without a content type', async () => {
    expect(
      await readOAuthBody(
        post('token=abc', 'application/x-www-form-urlencoded;charset=UTF-8')
      )
    ).toEqual({ token: 'abc' })
    const untyped = post('token=abc')
    untyped.headers.delete('content-type')
    expect(await readOAuthBody(untyped)).toEqual({ token: 'abc' })
  })

  it('reads JSON bodies and rejects malformed ones', async () => {
    expect(
      await readOAuthBody(post('{"token":"abc"}', 'application/json'))
    ).toEqual({ token: 'abc' })
    await expect(
      readOAuthBody(post('{"token":', 'application/json'))
    ).rejects.toMatchObject({ code: 'invalid_request' })
  })

  it('validates against the schema', () => {
    expect(parseOAuth({ token: 'abc' }, oauthRevokeRequestSchema)).toEqual({
      token: 'abc'
    })
    expect(() => parseOAuth({}, oauthRevokeRequestSchema)).toThrow(
      ValidationError
    )
  })
})
