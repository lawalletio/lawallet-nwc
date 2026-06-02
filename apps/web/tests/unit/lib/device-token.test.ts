import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/types/server/errors'
import { Permission, Role } from '@/lib/auth/permissions'

vi.mock('@/lib/jwt', () => ({
  createJwtToken: vi.fn(() => 'signed.jwt.token'),
}))

import {
  parseDurationSeconds,
  normalizeDeviceTokenExpiry,
  mintDeviceToken,
  MIN_DEVICE_TOKEN_SECONDS,
} from '@/lib/auth/device-token'
import { createJwtToken } from '@/lib/jwt'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseDurationSeconds', () => {
  it('parses unit suffixes', () => {
    expect(parseDurationSeconds('30s')).toBe(30)
    expect(parseDurationSeconds('5m')).toBe(300)
    expect(parseDurationSeconds('8h')).toBe(8 * 3600)
    expect(parseDurationSeconds('7d')).toBe(7 * 86400)
    expect(parseDurationSeconds('2w')).toBe(2 * 604800)
  })

  it('treats a bare number as seconds (not milliseconds)', () => {
    expect(parseDurationSeconds('3600')).toBe(3600)
  })

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(parseDurationSeconds('  12H ')).toBe(12 * 3600)
  })

  it('throws on unparseable input', () => {
    expect(() => parseDurationSeconds('soon')).toThrow(ValidationError)
    expect(() => parseDurationSeconds('1y')).toThrow(ValidationError)
    expect(() => parseDurationSeconds('')).toThrow(ValidationError)
  })
})

describe('normalizeDeviceTokenExpiry', () => {
  it('returns a number for bare-second strings', () => {
    expect(normalizeDeviceTokenExpiry('3600')).toBe(3600)
  })

  it('passes unit strings through unchanged', () => {
    expect(normalizeDeviceTokenExpiry('8h')).toBe('8h')
    expect(normalizeDeviceTokenExpiry(' 7d ')).toBe('7d')
  })

  it('rejects durations below the minimum', () => {
    expect(() =>
      normalizeDeviceTokenExpiry(String(MIN_DEVICE_TOKEN_SECONDS - 1)),
    ).toThrow(/too short/i)
  })

  it('accepts the minimum and imposes no upper bound', () => {
    expect(normalizeDeviceTokenExpiry(String(MIN_DEVICE_TOKEN_SECONDS))).toBe(
      MIN_DEVICE_TOKEN_SECONDS,
    )
    // Long lifetimes that used to be rejected now pass — there is no maximum.
    expect(normalizeDeviceTokenExpiry('30d')).toBe('30d')
    expect(normalizeDeviceTokenExpiry('31d')).toBe('31d')
    expect(normalizeDeviceTokenExpiry('3650d')).toBe('3650d')
  })
})

describe('mintDeviceToken', () => {
  it('signs a token carrying identity, role, and an enforced scopes claim', () => {
    const token = mintDeviceToken({
      pubkey: 'f'.repeat(64),
      userId: 'user_123',
      role: Role.OPERATOR,
      scopes: [Permission.CARDS_READ, Permission.CARDS_WRITE],
      expiresIn: '8h',
      secret: 'shhh',
    })

    expect(token).toBe('signed.jwt.token')
    expect(createJwtToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'f'.repeat(64),
        pubkey: 'f'.repeat(64),
        role: Role.OPERATOR,
        scopes: [Permission.CARDS_READ, Permission.CARDS_WRITE],
        // mirrored into the legacy claim too
        permissions: [Permission.CARDS_READ, Permission.CARDS_WRITE],
        sub: 'user_123',
        kind: 'device',
      }),
      'shhh',
      expect.objectContaining({
        expiresIn: '8h',
        issuer: 'lawallet-nwc',
        audience: 'lawallet-users',
      }),
    )
  })
})
