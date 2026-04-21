import { describe, it, expect } from 'vitest'
import {
  parseNwcUri,
  derivePubkey,
  normalizeRelayUrl
} from '../../src/nostr/nwc.js'

const walletPubkey =
  'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4'
const secret =
  '71a8c14c1407c113601079c4302dab36ab0ec2b25f1d5dfcbdd6b2d0e2a0c5c4'

describe('parseNwcUri', () => {
  it('parses a canonical nostr+walletconnect URI', () => {
    const uri = `nostr+walletconnect://${walletPubkey}?relay=wss%3A%2F%2Frelay.example.com&secret=${secret}&lud16=alice%40example.com`
    const result = parseNwcUri(uri)
    expect(result.walletPubkey).toBe(walletPubkey)
    expect(result.clientSecret).toBe(secret)
    expect(result.relays).toEqual(['wss://relay.example.com'])
    expect(result.lud16).toBe('alice@example.com')
  })

  it('accepts legacy nostrwalletconnect:// form', () => {
    const uri = `nostrwalletconnect://${walletPubkey}?relay=wss%3A%2F%2Fa&relay=wss%3A%2F%2Fb&secret=${secret}`
    const result = parseNwcUri(uri)
    expect(result.relays).toEqual(['wss://a', 'wss://b'])
  })

  it('rejects non-NWC URIs', () => {
    expect(() => parseNwcUri('https://foo')).toThrow(/Not a NWC URI/)
  })

  it('rejects URIs with no relay', () => {
    expect(() =>
      parseNwcUri(`nostr+walletconnect://${walletPubkey}?secret=${secret}`)
    ).toThrow(/relay/)
  })

  it('rejects URIs with no secret', () => {
    expect(() =>
      parseNwcUri(
        `nostr+walletconnect://${walletPubkey}?relay=wss%3A%2F%2Fa`
      )
    ).toThrow(/secret/)
  })

  it('rejects URIs with bad wallet pubkey', () => {
    expect(() =>
      parseNwcUri(
        `nostr+walletconnect://nothex?relay=wss%3A%2F%2Fa&secret=${secret}`
      )
    ).toThrow(/wallet pubkey/)
  })
})

describe('derivePubkey', () => {
  it('returns a 64-char hex pubkey', () => {
    const pub = derivePubkey(secret)
    expect(pub).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('normalizeRelayUrl', () => {
  it('strips trailing slash and lowercases', () => {
    expect(normalizeRelayUrl('WSS://Relay.Example.com/')).toBe(
      'wss://relay.example.com'
    )
  })
})
