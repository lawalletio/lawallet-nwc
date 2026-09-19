import { describe, it, expect } from 'vitest'
import {
  isJwtDueForRefresh,
  isJwtExpired,
  readJwtExpiryMs,
  SESSION_REFRESH_BUFFER_MS
} from '@/lib/client/jwt-expiry'

function jwtWithExp(expSecondsFromNow: number): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' })
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + expSecondsFromNow
    })
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

describe('readJwtExpiryMs', () => {
  it('returns exp in milliseconds for a well-formed JWT', () => {
    const now = Date.now()
    const expiryMs = readJwtExpiryMs(jwtWithExp(60))
    expect(expiryMs).toBeGreaterThan(now + 50_000)
    expect(expiryMs).toBeLessThan(now + 70_000)
  })

  it('returns null for opaque non-JWT session tokens', () => {
    expect(readJwtExpiryMs('stored-tok')).toBeNull()
    expect(readJwtExpiryMs('')).toBeNull()
    expect(readJwtExpiryMs('only-one-segment')).toBeNull()
  })

  it('returns null for a JWT whose payload is not JSON', () => {
    expect(readJwtExpiryMs('a.%%%not-base64%%%.c')).toBeNull()
  })
})

describe('isJwtExpired / isJwtDueForRefresh', () => {
  it('treats a past exp as expired and due for refresh', () => {
    const token = jwtWithExp(-30)
    expect(isJwtExpired(token)).toBe(true)
    expect(isJwtDueForRefresh(token)).toBe(true)
  })

  it('treats a token inside the refresh buffer as due but not expired', () => {
    const token = jwtWithExp(120)
    expect(isJwtExpired(token)).toBe(false)
    expect(isJwtDueForRefresh(token)).toBe(true)
    expect(SESSION_REFRESH_BUFFER_MS).toBe(5 * 60 * 1000)
  })

  it('leaves a far-future token alone', () => {
    const token = jwtWithExp(60 * 60)
    expect(isJwtExpired(token)).toBe(false)
    expect(isJwtDueForRefresh(token)).toBe(false)
  })

  it('does not treat opaque tokens as expired', () => {
    expect(isJwtExpired('stored-tok')).toBe(false)
    expect(isJwtDueForRefresh('stored-tok')).toBe(false)
  })
})
