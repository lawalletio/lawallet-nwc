import { describe, it, expect, vi, afterEach } from 'vitest'
import { JwtValidationError, validateJwt } from '@/lib/client/auth-api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('validateJwt', () => {
  it('returns the session on 200', async () => {
    const session = { valid: true, pubkey: 'a'.repeat(64) }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(session)))
    )
    await expect(validateJwt('tok')).resolves.toEqual(session)
  })

  it.each([401, 403, 500])(
    'throws a JwtValidationError carrying status %i',
    async status => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status }))
      )
      const err = await validateJwt('tok').catch(e => e)
      expect(err).toBeInstanceOf(JwtValidationError)
      expect(err.status).toBe(status)
    }
  )

  it('lets a network failure through untouched (no status)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )
    const err = await validateJwt('tok').catch(e => e)
    expect(err).toBeInstanceOf(TypeError)
    expect(err.status).toBeUndefined()
  })
})
