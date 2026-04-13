import { describe, it, expect } from 'vitest'
import {
  generatePrivateKey,
  getPublicKeyFromPrivate,
  hexToNsec,
  nsecToHex,
  validateNsec,
  parseBunkerUrl,
} from '@/lib/nostr'

describe('generatePrivateKey', () => {
  it('returns a 64-character hex string', () => {
    const key = generatePrivateKey()
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique keys', () => {
    const k1 = generatePrivateKey()
    const k2 = generatePrivateKey()
    expect(k1).not.toBe(k2)
  })
})

describe('getPublicKeyFromPrivate', () => {
  it('derives a 64-character hex public key', () => {
    const privKey = generatePrivateKey()
    const pubKey = getPublicKeyFromPrivate(privKey)
    expect(pubKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    const privKey = generatePrivateKey()
    expect(getPublicKeyFromPrivate(privKey)).toBe(getPublicKeyFromPrivate(privKey))
  })

  it('different private keys produce different public keys', () => {
    const k1 = generatePrivateKey()
    const k2 = generatePrivateKey()
    expect(getPublicKeyFromPrivate(k1)).not.toBe(getPublicKeyFromPrivate(k2))
  })
})

describe('hexToNsec / nsecToHex round-trip', () => {
  it('converts hex to nsec and back', () => {
    const privKey = generatePrivateKey()
    const nsec = hexToNsec(privKey)
    expect(nsec).toMatch(/^nsec1/)
    expect(nsecToHex(nsec)).toBe(privKey)
  })
})

describe('nsecToHex', () => {
  it('throws for non-nsec bech32 input', () => {
    // npub is not nsec
    expect(() => nsecToHex('npub1abc')).toThrow()
  })

  it('throws for garbage input', () => {
    expect(() => nsecToHex('not-a-nsec')).toThrow()
  })
})

describe('validateNsec', () => {
  it('returns true for valid nsec', () => {
    const privKey = generatePrivateKey()
    const nsec = hexToNsec(privKey)
    expect(validateNsec(nsec)).toBe(true)
  })

  it('returns false for invalid string', () => {
    expect(validateNsec('not-a-nsec')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(validateNsec('')).toBe(false)
  })
})

describe('parseBunkerUrl', () => {
  it('parses a valid bunker URL with single relay', () => {
    const pubkey = 'a'.repeat(64)
    const url = `bunker://${pubkey}?relay=wss://relay.example.com`
    const result = parseBunkerUrl(url)
    expect(result.remoteUserPubkey).toBe(pubkey)
    expect(result.relays).toEqual(['wss://relay.example.com'])
    expect(result.secret).toBeUndefined()
  })

  it('parses bunker URL with multiple relays and secret', () => {
    const pubkey = 'b'.repeat(64)
    const url = `bunker://${pubkey}?relay=wss://r1.com&relay=wss://r2.com&secret=mysecret`
    const result = parseBunkerUrl(url)
    expect(result.remoteUserPubkey).toBe(pubkey)
    expect(result.relays).toEqual(['wss://r1.com', 'wss://r2.com'])
    expect(result.secret).toBe('mysecret')
  })

  it('throws for missing relays', () => {
    const pubkey = 'c'.repeat(64)
    expect(() => parseBunkerUrl(`bunker://${pubkey}`)).toThrow('Invalid bunker URL')
  })

  it('throws for invalid URL format', () => {
    expect(() => parseBunkerUrl('not-a-url')).toThrow()
  })
})
