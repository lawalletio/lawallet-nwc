import { describe, it, expect } from 'vitest'
import { scrubPii, scrubEvent } from '@/lib/observability/pii'

const HEX_A = 'a'.repeat(64)
const HEX_B = 'b'.repeat(6) + 'c'.repeat(58)
const NWC_URI = `nostr+walletconnect://${HEX_A}?relay=wss://relay.example.com&secret=${HEX_B}`

describe('scrubPii', () => {
  it('redacts an entire NWC connection string including relay and secret', () => {
    const out = scrubPii(`failed to connect to ${NWC_URI} after 3 tries`)
    expect(out).toBe('failed to connect to [redacted] after 3 tries')
    expect(out).not.toContain('walletconnect')
    expect(out).not.toContain('secret')
    expect(out).not.toContain(HEX_B)
  })

  it('redacts nsec keys', () => {
    const out = scrubPii(`invalid key nsec1${'q'.repeat(58)} provided`)
    expect(out).toBe('invalid key [redacted] provided')
  })

  it('redacts npub keys', () => {
    const out = scrubPii(`user npub1${'z'.repeat(58)} not found`)
    expect(out).toBe('user [redacted] not found')
  })

  it('redacts lnbc invoices', () => {
    const out = scrubPii(`pay lnbc21u1p${'x'.repeat(40)} now`)
    expect(out).toBe('pay [redacted] now')
  })

  it('redacts bare 64-char hex strings', () => {
    const out = scrubPii(`pubkey ${HEX_A} rejected`)
    expect(out).toBe('pubkey [redacted] rejected')
  })

  it('redacts email-shaped addresses', () => {
    const out = scrubPii('LUD-16 lookup for alice@example.com failed')
    expect(out).toBe('LUD-16 lookup for [redacted] failed')
  })

  it('does not mangle route paths containing lnurlp', () => {
    const path = '/api/lud16/alice/lnurlp/callback'
    expect(scrubPii(`GET ${path} failed`)).toBe(`GET ${path} failed`)
  })

  it('leaves ordinary text untouched', () => {
    const text = 'Card design not found for id 42'
    expect(scrubPii(text)).toBe(text)
  })
})

describe('scrubEvent', () => {
  it('scrubs message, exception values and breadcrumb messages', () => {
    const event = {
      message: `boom ${NWC_URI}`,
      exception: {
        values: [{ value: `key nsec1${'q'.repeat(58)} leaked` }]
      },
      breadcrumbs: [
        { message: `fetched ${HEX_A}`, data: { email: 'bob@example.com' } },
        { message: 'plain breadcrumb' }
      ]
    }

    const out = scrubEvent(event)

    expect(out.message).toBe('boom [redacted]')
    expect(out.exception!.values![0]!.value).toBe('key [redacted] leaked')
    expect(out.breadcrumbs![0]!.message).toBe('fetched [redacted]')
    expect(out.breadcrumbs![0]!.data!.email).toBe('[redacted]')
    expect(out.breadcrumbs![1]!.message).toBe('plain breadcrumb')
  })

  it('scrubs Nostr-shaped secrets embedded in event.tags (defense-in-depth)', () => {
    const nsec = `nsec1${'q'.repeat(58)}`
    const npub = `npub1${'z'.repeat(58)}`
    const event = {
      tags: {
        // A Nostr-shaped secret attached by any caller via
        // `Sentry.captureException(e, { tags })` or `Sentry.setTag(...)` would
        // previously reach Sentry verbatim because scrubEvent skipped tags.
        secretKey: nsec,
        pubKey: npub,
        walletUri: NWC_URI,
        // Non-secret values must survive untouched so Sentry stays useful.
        code: 'INTERNAL',
        retryable: false,
        attempts: 3
      }
    }

    const out = scrubEvent(event)

    expect(out.tags!.secretKey).toBe('[redacted]')
    expect(out.tags!.pubKey).toBe('[redacted]')
    expect(out.tags!.walletUri).toBe('[redacted]')
    expect(out.tags!.code).toBe('INTERNAL')
    expect(out.tags!.retryable).toBe(false)
    expect(out.tags!.attempts).toBe(3)
    expect(JSON.stringify(out)).not.toContain(nsec)
    expect(JSON.stringify(out)).not.toContain(npub)
    expect(JSON.stringify(out)).not.toContain(NWC_URI)
  })

  it('preserves non-string tag values verbatim (numbers, booleans, null, undefined)', () => {
    const event = {
      tags: {
        count: 42,
        enabled: true,
        missing: null,
        omitted: undefined,
        nested: { raw: 'objects-are-not-string-redacted' }
      }
    }

    const out = scrubEvent(event)

    expect(out.tags).toEqual({
      count: 42,
      enabled: true,
      missing: null,
      omitted: undefined,
      // Object.entries drops `undefined` from the iteration, so the key is
      // re-assigned only for present string values; the non-string branches
      // leave the original object reference untouched.
      nested: { raw: 'objects-are-not-string-redacted' }
    })
    // Also confirm the field is not re-typed by asserting the original
    // object identity on non-string entries (scrubEvent mutates but does not
    // reassign the whole tags object).
    expect(out.tags === event.tags).toBe(true)
  })

  it('handles missing tags, empty tags, and tags with only non-string values without throwing', () => {
    expect(
      scrubEvent<{ tags?: Record<string, unknown> }>({}).tags
    ).toBeUndefined()
    expect(scrubEvent({ tags: {} }).tags).toEqual({})
    expect(scrubEvent({ tags: { count: 1 } }).tags).toEqual({ count: 1 })
  })
})
