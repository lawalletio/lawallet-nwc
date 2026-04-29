import { describe, it, expect, vi } from 'vitest'
import {
  parseDestination,
  DestinationParseError,
} from '@/lib/client/nwc/parse-destination'

// Silence debug logs from the bolt11 decoder on failures we trigger deliberately.
vi.mock('light-bolt11-decoder', async importOriginal => {
  const actual = await importOriginal<typeof import('light-bolt11-decoder')>()
  return {
    ...actual,
    decode: (input: string) => {
      if (input === 'lnbc_valid_mock') {
        return {
          sections: [
            { name: 'amount', value: '1500000' },
            { name: 'description', value: 'test invoice' },
            { name: 'payment_hash', value: 'abc123' },
            { name: 'timestamp', value: 1_700_000_000 },
          ],
          expiry: 3600,
        } as never
      }
      return actual.decode(input)
    },
  }
})

describe('parseDestination', () => {
  it('parses a Lightning address', () => {
    const result = parseDestination('satoshi@example.com')
    expect(result.kind).toBe('lnurl-pay')
    if (result.kind !== 'lnurl-pay') return
    expect(result.address).toBe('satoshi@example.com')
    expect(result.username).toBe('satoshi')
    expect(result.host).toBe('example.com')
    expect(result.lnurlpUrl).toBe(
      'https://example.com/.well-known/lnurlp/satoshi',
    )
  })

  it('strips the `lightning:` scheme prefix', () => {
    const result = parseDestination('lightning:satoshi@example.com')
    expect(result.kind).toBe('lnurl-pay')
    if (result.kind !== 'lnurl-pay') return
    expect(result.address).toBe('satoshi@example.com')
  })

  it('parses a bolt11 invoice (via mocked decoder)', () => {
    const result = parseDestination('lnbc_valid_mock')
    expect(result.kind).toBe('invoice')
    if (result.kind !== 'invoice') return
    expect(result.amountSats).toBe(1500)
    expect(result.description).toBe('test invoice')
    expect(result.paymentHash).toBe('abc123')
    expect(result.expiresAt).toBe((1_700_000_000 + 3600) * 1000)
  })

  it('rejects an empty input', () => {
    expect(() => parseDestination('   ')).toThrow(DestinationParseError)
  })

  it('rejects random garbage', () => {
    expect(() => parseDestination('not-a-destination')).toThrow(
      DestinationParseError,
    )
  })

  it('rejects an invalid bolt11 string', () => {
    expect(() => parseDestination('lnbcbogus')).toThrow(DestinationParseError)
  })

  it('handles an npub with a stub destination', () => {
    const npub = 'npub1' + 'q'.repeat(58)
    const result = parseDestination(npub)
    expect(result.kind).toBe('npub')
    if (result.kind !== 'npub') return
    expect(result.npub).toBe(npub)
  })
})
