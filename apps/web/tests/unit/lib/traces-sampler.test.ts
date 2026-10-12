import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRACES_SAMPLE_RATE,
  sampleServerTrace
} from '@/lib/observability/traces-sampler'

const rate = (name: string) => sampleServerTrace({ name })

describe('sampleServerTrace', () => {
  it.each([
    'GET /api/health',
    'GET /api/health/db',
    'GET /api/status',
    'GET /api/events'
  ])('never traces %s', name => {
    expect(rate(name)).toBe(0)
  })

  it.each([
    'GET /api/lud16/[username]',
    'GET /api/lud16/[username]/callback',
    'GET /.well-known/lnurlp/[username]',
    'GET /.well-known/nostr.json'
  ])('samples %s at 5%%', name => {
    expect(rate(name)).toBe(0.05)
  })

  it.each([
    'GET /api/wallet',
    'POST /api/eventsource-like',
    'GET /api/lud16-ish',
    'GET /wallet'
  ])('keeps the default rate for %s', name => {
    expect(rate(name)).toBe(DEFAULT_TRACES_SAMPLE_RATE)
  })
})
