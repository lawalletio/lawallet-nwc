import { describe, expect, it } from 'vitest'
import { nip19 } from 'nostr-tools'

import {
  normalizeNostrPubkey,
  parseKind0Content,
  parseKind0ContentWithRaw,
} from '@/lib/nostr/profile'

const PUBKEY = 'a'.repeat(64)

describe('normalizeNostrPubkey', () => {
  it('normalizes 64-char hex pubkeys and indexes them by npub', () => {
    const result = normalizeNostrPubkey(PUBKEY.toUpperCase())

    expect(result).toEqual({
      pubkey: PUBKEY,
      npub: nip19.npubEncode(PUBKEY),
    })
  })

  it('decodes valid npubs', () => {
    const npub = nip19.npubEncode(PUBKEY)
    const result = normalizeNostrPubkey(npub)

    expect(result?.pubkey).toBe(PUBKEY)
    expect(result?.npub).toBe(npub)
  })

  it('rejects invalid npub input', () => {
    expect(normalizeNostrPubkey('npub1not-valid')).toBeNull()
    expect(normalizeNostrPubkey('')).toBeNull()
  })
})

describe('parseKind0Content', () => {
  it('maps Nostr kind-0 fields used by the app', () => {
    const profile = parseKind0Content(
      PUBKEY,
      JSON.stringify({
        name: 'alice',
        display_name: 'Alice A.',
        lud16: 'alice@example.com',
        picture: 'https://cdn.example.com/avatar.jpg',
        banner: 'https://cdn.example.com/cover.jpg',
      }),
      { fetchedAt: 123 },
    )

    expect(profile).toMatchObject({
      pubkey: PUBKEY,
      npub: nip19.npubEncode(PUBKEY),
      name: 'alice',
      displayName: 'Alice A.',
      lud16: 'alice@example.com',
      picture: 'https://cdn.example.com/avatar.jpg',
      banner: 'https://cdn.example.com/cover.jpg',
      fetchedAt: 123,
    })
  })

  it('supports displayName camelCase fallback and returns raw metadata', () => {
    const parsed = parseKind0ContentWithRaw(
      PUBKEY,
      JSON.stringify({
        username: 'bob',
        displayName: 'Bob B.',
        website: 'https://example.com',
      }),
    )

    expect(parsed?.profile).toMatchObject({
      name: 'bob',
      displayName: 'Bob B.',
      website: 'https://example.com',
    })
    expect(parsed?.rawMetadata).toMatchObject({ displayName: 'Bob B.' })
  })

  it('rejects invalid JSON and non-object metadata', () => {
    expect(parseKind0Content(PUBKEY, 'not-json')).toBeNull()
    expect(parseKind0Content(PUBKEY, '[]')).toBeNull()
  })
})
