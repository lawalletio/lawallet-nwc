import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  scrubPii,
  scrubEvent,
  redactPathBearerTokens
} from '@/lib/observability/pii'

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

  it('redacts bearer-token path segments in event.request.url', () => {
    const otc = 'a'.repeat(32)
    const edk = 'external-device-key-abc123'
    const activationId = 'b'.repeat(32)

    const otcEvent = {
      request: { url: `https://example.com/api/cards/otc/${otc}` }
    }
    const otcOut = scrubEvent(otcEvent)
    expect(otcOut.request!.url).toBe('https://example.com/api/cards/otc/[otc]')
    expect(otcOut.request!.url).not.toContain(otc)

    const edkEvent = {
      request: {
        url: `https://example.com/api/remote-connections/${edk}/cards`
      }
    }
    const edkOut = scrubEvent(edkEvent)
    expect(edkOut.request!.url).toBe(
      'https://example.com/api/remote-connections/[externalDeviceKey]/cards'
    )
    expect(edkOut.request!.url).not.toContain(edk)

    const activationEvent = {
      request: {
        url: `https://example.com/api/activation-tokens/${activationId}/claim`
      }
    }
    const activationOut = scrubEvent(activationEvent)
    expect(activationOut.request!.url).toBe(
      'https://example.com/api/activation-tokens/[id]/claim'
    )
    expect(activationOut.request!.url).not.toContain(activationId)
  })

  it('does not redact a benign card id in event.request.url', () => {
    const cardId = 'c'.repeat(32)
    const event = {
      request: { url: `https://example.com/api/cards/${cardId}` }
    }
    const out = scrubEvent(event)
    // /api/cards/[id] is an authenticated route — not a bearer-token path
    expect(out.request!.url).toBe(`https://example.com/api/cards/${cardId}`)
  })

  it('scrubs 64-hex pubkeys and LUD-16 addresses in transaction http.target', () => {
    // Mirrors the Sentry transaction payload Next.js emits for sampled
    // App-Router requests: `event.type === 'transaction'` and the raw
    // `req.url` (path + query) lives in `contexts.trace.data['http.target']`.
    // `beforeSend` never sees this shape — `beforeSendTransaction` does.
    const event = {
      type: 'transaction' as const,
      transaction: `/api/account/identities/${HEX_A}`,
      contexts: {
        trace: {
          data: {
            'http.target': `/api/lud16/alice@example.com?pubkey=${HEX_A}`,
            'http.url': `/api/account/identities/${HEX_A}`,
            'http.method': 'GET',
            'http.status_code': 200
          }
        }
      }
    }

    const out = scrubEvent(event)

    expect(out.transaction).toBe('/api/account/identities/[redacted]')
    expect(out.contexts!.trace!.data!['http.target']).toBe(
      '/api/lud16/[redacted]?pubkey=[redacted]'
    )
    expect(out.contexts!.trace!.data!['http.url']).toBe(
      '/api/account/identities/[redacted]'
    )
    expect(out.contexts!.trace!.data!['http.method']).toBe('GET')
    expect(out.contexts!.trace!.data!['http.status_code']).toBe(200)
    expect(JSON.stringify(out)).not.toContain(HEX_A)
    expect(JSON.stringify(out)).not.toContain('alice@example.com')
  })

  it('leaves missing or non-string transaction trace attributes alone', () => {
    expect(scrubEvent({}).contexts).toBeUndefined()
    expect(
      scrubEvent({
        contexts: { trace: { data: { 'http.status_code': 500 } } }
      }).contexts!.trace!.data
    ).toEqual({ 'http.status_code': 500 })
  })

  it('scrubs query strings, span descriptions, and unparseable request URLs', () => {
    const nsec = `nsec1${'q'.repeat(58)}`
    const out = scrubEvent({
      request: {
        url: 'not a url nsec1' + 'q'.repeat(58),
        query_string: `secret=${nsec}`
      },
      spans: [{ description: `pay ${NWC_URI}` }, { description: 'idle' }]
    })

    expect(out.request!.url).toBe('not a url [redacted]')
    expect(out.request!.query_string).toBe('secret=[redacted]')
    expect(out.spans![0]!.description).toBe('pay [redacted]')
    expect(out.spans![1]!.description).toBe('idle')
  })
})

describe('Sentry instrumentation wiring', () => {
  it('registers beforeSendTransaction next to beforeSend', () => {
    const server = readFileSync(
      join(process.cwd(), 'instrumentation.ts'),
      'utf8'
    )
    const client = readFileSync(
      join(process.cwd(), 'instrumentation-client.ts'),
      'utf8'
    )

    expect(server).toMatch(/beforeSend:\s*event\s*=>\s*scrubEvent\(event\)/)
    expect(server).toMatch(
      /beforeSendTransaction:\s*event\s*=>\s*scrubEvent\(event\)/
    )
    expect(client).toMatch(/beforeSend:\s*event\s*=>\s*scrubEvent\(event\)/)
    expect(client).toMatch(
      /beforeSendTransaction:\s*event\s*=>\s*scrubEvent\(event\)/
    )
  })
})

describe('redactPathBearerTokens', () => {
  it('redacts OTC segment in /api/cards/otc/<OTC>', () => {
    const otc = 'a'.repeat(32)
    expect(redactPathBearerTokens(`/api/cards/otc/${otc}`)).toBe(
      '/api/cards/otc/[otc]'
    )
  })

  it('redacts OTC segment in /api/cards/otc/<OTC>/activate', () => {
    const otc = 'a'.repeat(32)
    expect(redactPathBearerTokens(`/api/cards/otc/${otc}/activate`)).toBe(
      '/api/cards/otc/[otc]/activate'
    )
  })

  it('redacts externalDeviceKey segment in /api/remote-connections/<EDK>', () => {
    expect(
      redactPathBearerTokens('/api/remote-connections/my-device-key-123')
    ).toBe('/api/remote-connections/[externalDeviceKey]')
  })

  it('redacts externalDeviceKey segment in /api/remote-connections/<EDK>/cards', () => {
    expect(
      redactPathBearerTokens('/api/remote-connections/my-device-key-123/cards')
    ).toBe('/api/remote-connections/[externalDeviceKey]/cards')
  })

  it('redacts activation-token id in /api/activation-tokens/<id>', () => {
    const id = 'b'.repeat(32)
    expect(redactPathBearerTokens(`/api/activation-tokens/${id}`)).toBe(
      '/api/activation-tokens/[id]'
    )
  })

  it('redacts activation-token id in /api/activation-tokens/<id>/claim', () => {
    const id = 'b'.repeat(32)
    expect(redactPathBearerTokens(`/api/activation-tokens/${id}/claim`)).toBe(
      '/api/activation-tokens/[id]/claim'
    )
  })

  it('does not redact /api/cards/[id] (authenticated route, not a bearer-token path)', () => {
    const id = 'c'.repeat(32)
    expect(redactPathBearerTokens(`/api/cards/${id}`)).toBe(`/api/cards/${id}`)
  })

  it('returns undefined unchanged', () => {
    expect(redactPathBearerTokens(undefined)).toBeUndefined()
  })

  it('returns non-matching paths unchanged', () => {
    expect(redactPathBearerTokens('/api/users/me')).toBe('/api/users/me')
  })
})
