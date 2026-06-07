import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { npubInitials, toNpub } from '@/lib/client/format'

describe('toNpub', () => {
  it('encodes a hex pubkey to its full npub form', () => {
    const pubkey = 'a'.repeat(64)
    const npub = toNpub(pubkey)
    expect(npub).toBe(nip19.npubEncode(pubkey))
    expect(npub.startsWith('npub1')).toBe(true)
    // Round-trips back to the original hex.
    expect(nip19.decode(npub).data).toBe(pubkey)
  })

  it('returns the input unchanged when it cannot be encoded', () => {
    expect(toNpub('not-hex')).toBe('not-hex')
  })
})

describe('npubInitials', () => {
  it('returns the first two npub characters after the npub1 prefix, uppercased', () => {
    const pubkey = 'a'.repeat(64)
    const npub = nip19.npubEncode(pubkey)
    // The data part starts right after the 5-char `npub1` prefix.
    expect(npubInitials(pubkey)).toBe(npub.slice(5, 7).toUpperCase())
    expect(npubInitials(pubkey)).toHaveLength(2)
  })

  it('is independent of any profile name (purely npub-derived)', () => {
    const a = 'a'.repeat(64)
    const b = 'b'.repeat(64)
    expect(npubInitials(a)).not.toBe(npubInitials(b))
  })

  it('returns ?? for a missing pubkey', () => {
    expect(npubInitials(null)).toBe('??')
    expect(npubInitials(undefined)).toBe('??')
    expect(npubInitials('')).toBe('??')
  })

  it('falls back to the uppercased prefix for an unencodable pubkey', () => {
    expect(npubInitials('zz')).toBe('ZZ')
  })
})
