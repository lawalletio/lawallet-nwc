import { describe, it, expect } from 'vitest'
import { nip19 } from 'nostr-tools'
import { npubInitials } from '@/lib/client/format'

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
