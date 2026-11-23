import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createJwtToken,
  verifyJwtToken,
  extractJwtFromHeader,
  validateJwtFromRequest
} from '@/lib/jwt'

const SECRET = 'test-secret-key-that-is-long-enough'

function makeToken(
  overrides: Record<string, any> = {},
  options: { expiresIn?: string | number } = {}
) {
  return createJwtToken({ userId: 'user_1', ...overrides }, SECRET, {
    expiresIn: options.expiresIn ?? '1h'
  })
}

describe('createJwtToken', () => {
  it('creates a valid token string', () => {
    const token = makeToken()
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)
  })

  it('encodes userId in the payload', () => {
    const token = makeToken({ userId: 'abc' })
    const result = verifyJwtToken(token, SECRET)
    expect(result.payload.userId).toBe('abc')
  })

  it('uses HS256 by default', () => {
    const token = makeToken()
    const result = verifyJwtToken(token, SECRET)
    expect(result.header.alg).toBe('HS256')
  })

  it('sets expiration', () => {
    const token = makeToken({}, { expiresIn: '2h' })
    const result = verifyJwtToken(token, SECRET)
    expect(result.payload.exp).toBeGreaterThan(result.payload.iat)
  })

  it('supports issuer and audience options', () => {
    const token = createJwtToken({ userId: 'u1' }, SECRET, {
      issuer: 'test-issuer',
      audience: 'test-audience'
    })
    const result = verifyJwtToken(token, SECRET)
    expect(result.payload.iss).toBe('test-issuer')
    expect(result.payload.aud).toBe('test-audience')
  })
})

describe('verifyJwtToken', () => {
  it('verifies a valid token', () => {
    const token = makeToken()
    const result = verifyJwtToken(token, SECRET)
    expect(result.payload.userId).toBe('user_1')
    expect(result.header.alg).toBe('HS256')
  })

  it('throws for invalid secret', () => {
    const token = makeToken()
    expect(() => verifyJwtToken(token, 'wrong-secret')).toThrow('Invalid token')
  })

  it('throws for expired token', () => {
    const token = createJwtToken({ userId: 'u1' }, SECRET, { expiresIn: 0 })
    expect(() => verifyJwtToken(token, SECRET)).toThrow('Token has expired')
  })

  it('throws for malformed token', () => {
    expect(() => verifyJwtToken('not.a.token', SECRET)).toThrow('Invalid token')
  })

  it('accepts clockTolerance', () => {
    const token = createJwtToken({ userId: 'u1' }, SECRET, { expiresIn: 0 })
    // With a large clock tolerance, the expired token should pass
    const result = verifyJwtToken(token, SECRET, { clockTolerance: 60 })
    expect(result.payload.userId).toBe('u1')
  })

  it('validates issuer when specified', () => {
    const token = createJwtToken({ userId: 'u1' }, SECRET, {
      issuer: 'correct-issuer'
    })
    expect(() =>
      verifyJwtToken(token, SECRET, { issuer: 'wrong-issuer' })
    ).toThrow('Invalid token')
  })

  it('validates audience when specified', () => {
    const token = createJwtToken({ userId: 'u1' }, SECRET, {
      audience: 'correct-audience'
    })
    expect(() =>
      verifyJwtToken(token, SECRET, { audience: 'wrong-audience' })
    ).toThrow('Invalid token')
  })
})

describe('extractJwtFromHeader', () => {
  it('extracts token from Bearer header', () => {
    expect(extractJwtFromHeader('Bearer my-token')).toBe('my-token')
  })

  it('throws for null header', () => {
    expect(() => extractJwtFromHeader(null)).toThrow(
      'Authorization header is required'
    )
  })

  it('throws for non-Bearer prefix', () => {
    expect(() => extractJwtFromHeader('Basic abc')).toThrow(
      'Authorization header must start with "Bearer "'
    )
  })

  it('throws for empty token after Bearer', () => {
    expect(() => extractJwtFromHeader('Bearer ')).toThrow('Token is required')
  })
})

describe('validateJwtFromRequest', () => {
  it('validates JWT from request Authorization header', async () => {
    const token = makeToken()
    const request = new Request('http://localhost/api/test', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const result = await validateJwtFromRequest(request, SECRET)
    expect(result.payload.userId).toBe('user_1')
  })

  it('throws when Authorization header is missing', async () => {
    const request = new Request('http://localhost/api/test')
    await expect(validateJwtFromRequest(request, SECRET)).rejects.toThrow(
      'Authorization header is required'
    )
  })
})
