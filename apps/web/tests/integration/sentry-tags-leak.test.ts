/**
 * Integration test: verifies the end-to-end Sentry SDK contract that the
 * `beforeSend: scrubEvent` wiring (set in `instrumentation.ts` /
 * `instrumentation-client.ts`) actually receives `event.tags` populated
 * from `captureException(..., { tags })`, that string tag values are
 * scrubbed when they contain Nostr-shaped secrets, and that benign tag
 * values the caller attached (e.g. the redacted route pattern) reach the
 * transport boundary unchanged. Exercises the real `@sentry/nextjs` SDK —
 * no mocks of the SDK internals — using a custom transport that captures
 * the serialized envelope at the wire boundary.
 *
 * The Sentry event pipeline — scope merge of `CaptureContext.tags` →
 * `event.tags`, then `beforeSend` mutation, then transport — is the
 * contract under test. Envelopes are newline-delimited JSON
 * (header / item-header / item-payload); we parse the payload directly
 * rather than depend on `parseEnvelope` (only exported from `@sentry/core`,
 * which is not a direct dep of this app).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import * as Sentry from '@sentry/nextjs'

import { scrubEvent } from '@/lib/observability/pii'

const OTC = 'a'.repeat(32) // 32-hex bearer credential (card activation code)
const OTC_ROUTE_PATTERN = '/api/cards/otc/[otc]'
const NSEC = `nsec1${'q'.repeat(58)}`

let transportBody: string | Uint8Array | undefined

beforeAll(() => {
  Sentry.init({
    dsn: 'https://key@example.com/1',
    transport: (initOptions: unknown) =>
      (
        Sentry as unknown as {
          createTransport: (
            opts: unknown,
            makeRequest: (args: {
              body: string | Uint8Array
            }) => Promise<unknown>
          ) => unknown
        }
      ).createTransport(initOptions, ({ body }) => {
        transportBody = body
        return Promise.resolve({ statusCode: 200 })
      }),
    // Disable all default integrations so the environment (happy-dom) and
    // browser-only APIs do not interpose breadcrumbs / sessions / etc. that
    // would make assertions on the serialized event non-deterministic.
    integrations: [],
    sendDefaultPii: false,
    beforeSend: (event: unknown) => scrubEvent(event as never) as never
  } as never)
})

afterAll(async () => {
  await Sentry.flush(2000)
  await Sentry.close(2000)
})

beforeEach(() => {
  transportBody = undefined
})

/**
 * Extracts the event payload from a Sentry envelope. Envelopes are
 * newline-delimited JSON: envelope-header, item-header, item-payload (the
 * event), with each item being a (header, payload) pair. For a single
 * `captureException` call, the envelope has exactly one item whose header
 * type is `event` (or `transaction`), and its payload is the event itself.
 */
function extractEvent(body: string | Uint8Array): Record<string, unknown> {
  const text = typeof body === 'string' ? body : new TextDecoder().decode(body)
  const lines = text.split('\n')
  // Line 0 is the envelope header; line 1 is the first item's header; line 2
  // is the first item's payload. Guard against empty trailing lines.
  for (let i = 1; i < lines.length; i += 2) {
    const itemHeader = lines[i] ? JSON.parse(lines[i]) : null
    if (!itemHeader) continue
    if (itemHeader.type === 'event' || itemHeader.type === 'transaction') {
      return JSON.parse(lines[i + 1])
    }
  }
  throw new Error(
    `No event item in transport envelope. Lines: ${lines.length}. Body: ${text.slice(0, 200)}`
  )
}

describe('Sentry tags leak — SDK contract (real @sentry/nextjs pipeline)', () => {
  it('forwards the caller-attached tags.path to event.tags at the transport boundary', async () => {
    // Simulates the post-fix error-handler caller: it passes the redacted
    // route pattern (not the raw pathname) into captureException's tags.
    Sentry.captureException(new Error('Database connection failed'), {
      tags: { path: OTC_ROUTE_PATTERN, code: 'INTERNAL' }
    })
    await Sentry.flush(2000)

    expect(transportBody).toBeDefined()
    const event = extractEvent(transportBody!)
    expect((event as { tags?: Record<string, unknown> }).tags?.path).toBe(
      OTC_ROUTE_PATTERN
    )
    expect((event as { tags?: Record<string, unknown> }).tags?.code).toBe(
      'INTERNAL'
    )
    // The route pattern contains no Nostr-shaped secret, so scrubEvent must
    // leave it alone — and the OTC must not appear anywhere on the event.
    expect(JSON.stringify(event)).not.toContain(OTC)
  })

  it('scrubs Nostr-shaped secrets embedded in event.tags via defense-in-depth', async () => {
    // Even if a caller forgets to redact and attaches a Nostr secret
    // directly, `beforeSend: scrubEvent` must remove it before the event
    // crosses the transport boundary.
    Sentry.captureException(new Error('boom'), {
      tags: {
        signerKey: NSEC,
        path: OTC_ROUTE_PATTERN,
        attempts: 3,
        retryable: false
      }
    })
    await Sentry.flush(2000)

    const event = extractEvent(transportBody!)
    const tags = (event as { tags?: Record<string, unknown> }).tags
    expect(tags?.signerKey).toBe('[redacted]')
    expect(tags?.path).toBe(OTC_ROUTE_PATTERN)
    expect(tags?.attempts).toBe(3)
    expect(tags?.retryable).toBe(false)
    expect(JSON.stringify(event)).not.toContain(NSEC)
  })

  it('does not redact a benign 32-hex card id placed in tags.path (kept actionable for debugging)', async () => {
    // Card IDs are 32-hex (same shape as an OTC) but NOT bearer tokens — they
    // surface in /api/cards/[id] routes that require auth. scrubPii's regex
    // also only matches exactly-64-hex by design (per pii.ts:18), so a
    // 32-hex card id is not a Nostr secret shape and must survive scrubbing.
    const cardId = 'b'.repeat(32)
    Sentry.captureException(new Error('validation failed'), {
      tags: { path: `/api/cards/${cardId}` }
    })
    await Sentry.flush(2000)

    const event = extractEvent(transportBody!)
    expect((event as { tags?: Record<string, unknown> }).tags?.path).toBe(
      `/api/cards/${cardId}`
    )
  })
})
