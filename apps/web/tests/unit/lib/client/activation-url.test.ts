import { describe, it, expect } from 'vitest'
import {
  parseActivationUrl,
  isSameInstanceHost,
} from '@/lib/client/activation-url'

describe('parseActivationUrl', () => {
  it('parses a standard activation URL', () => {
    const result = parseActivationUrl(
      'https://app.example.com/wallet/activate/deadbeefcafe0123',
    )
    expect(result).toEqual({
      tokenId: 'deadbeefcafe0123',
      host: 'app.example.com',
    })
  })

  it('tolerates a trailing slash (legacy OTC link shape)', () => {
    const result = parseActivationUrl(
      'https://example.com/wallet/activate/abc123/',
    )
    expect(result).toEqual({ tokenId: 'abc123', host: 'example.com' })
  })

  it('keeps the port in the host for a same-instance comparison', () => {
    const result = parseActivationUrl(
      'http://localhost:3000/wallet/activate/token1',
    )
    expect(result).toEqual({ tokenId: 'token1', host: 'localhost:3000' })
  })

  it('trims surrounding whitespace', () => {
    const result = parseActivationUrl(
      '  https://example.com/wallet/activate/tok  ',
    )
    expect(result?.tokenId).toBe('tok')
  })

  it('returns null for non-activation paths', () => {
    expect(
      parseActivationUrl('https://example.com/wallet/send/foo'),
    ).toBeNull()
    expect(
      parseActivationUrl('https://example.com/wallet/activate'),
    ).toBeNull()
    expect(
      parseActivationUrl('https://example.com/wallet/activate/a/b'),
    ).toBeNull()
  })

  it('returns null for non-http(s) and non-URL inputs', () => {
    expect(parseActivationUrl('lnbc1abcdef')).toBeNull()
    expect(parseActivationUrl('lnurl1xyz')).toBeNull()
    expect(parseActivationUrl('satoshi@example.com')).toBeNull()
    expect(parseActivationUrl('not a url')).toBeNull()
    expect(parseActivationUrl('')).toBeNull()
    expect(
      parseActivationUrl('ftp://example.com/wallet/activate/tok'),
    ).toBeNull()
  })

  it('rejects an id segment with disallowed characters', () => {
    expect(
      parseActivationUrl('https://example.com/wallet/activate/bad id'),
    ).toBeNull()
  })
})

describe('isSameInstanceHost', () => {
  it('matches the current window host (case-insensitively)', () => {
    expect(isSameInstanceHost(window.location.host)).toBe(true)
    expect(isSameInstanceHost(window.location.host.toUpperCase())).toBe(true)
  })

  it('rejects a different host', () => {
    expect(isSameInstanceHost('some-other-host.example')).toBe(false)
  })
})
