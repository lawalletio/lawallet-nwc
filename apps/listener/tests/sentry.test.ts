import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureSession: vi.fn(),
  captureException: vi.fn(),
  pinoIntegration: vi.fn(() => ({ name: 'Pino' })),
  endSession: vi.fn(),
  flush: vi.fn(async () => true)
}))

import * as Sentry from '@sentry/node'
import type { ListenerEnv } from '../src/env'
import {
  captureException,
  endSentrySession,
  flushSentry,
  initSentry,
  reportError,
  sampleTrace,
  transportFailureFingerprint
} from '../src/sentry'

describe('transportFailureFingerprint', () => {
  it.each([
    [
      'Failed to connect to wss://relay.damus.io',
      ['nwc-transport', 'relay_connect', 'wss://relay.damus.io']
    ],
    [
      'no info event (kind 13194) returned from relay',
      ['nwc-transport', 'no_info_event']
    ],
    ['reply timeout: event abc123', ['nwc-transport', 'reply_timeout']],
    [
      'failed to publish: AggregateError: All promises were rejected',
      ['nwc-transport', 'publish_failed']
    ]
  ])('classifies %s as a transport failure', (message, fingerprint) => {
    expect(transportFailureFingerprint(new Error(message))).toEqual(fingerprint)
    // Process-level rejections can arrive as bare strings.
    expect(transportFailureFingerprint(message)).toEqual(fingerprint)
  })

  it('does not classify a generic error', () => {
    expect(transportFailureFingerprint(new Error('boom'))).toBeNull()
    expect(
      transportFailureFingerprint({ message: 'reply timeout:' })
    ).toBeNull()
  })
})

describe('captureException', () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear()
    initSentry({ SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' } as ListenerEnv)
  })

  it('sends transport failures as one warning issue per kind', () => {
    const err = new Error('Failed to connect to wss://relay.damus.io')
    captureException(err, { tags: { walletId: 'w1' } })
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { walletId: 'w1' },
      level: 'warning',
      fingerprint: ['nwc-transport', 'relay_connect', 'wss://relay.damus.io']
    })
  })

  it('keeps everything else at the default error level', () => {
    const err = new Error('boom')
    captureException(err, { tags: { kind: 'uncaught_exception' } })
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { kind: 'uncaught_exception' }
    })
  })
})

describe('reportError', () => {
  beforeEach(() => {
    vi.mocked(Sentry.captureException).mockClear()
    initSentry({ SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' } as ListenerEnv)
  })

  it('captures a site once per window, tagged with the site', () => {
    const err = new Error('db down')
    reportError(err, 'reconcile.periodic_failed:test')
    reportError(err, 'reconcile.periodic_failed:test')
    expect(Sentry.captureException).toHaveBeenCalledTimes(1)
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      tags: { site: 'reconcile.periodic_failed:test' }
    })
  })
})

describe('sampleTrace', () => {
  const inheritOrSampleWith = (rate: number) => rate

  it.each([
    'GET /health',
    'GET /ready',
    'GET /status',
    'GET /v1/nwc/payments/abc'
  ])('never traces %s', name =>
    expect(sampleTrace({ name, inheritOrSampleWith })).toBe(0)
  )

  it('inherits web sampling for payment requests, else a low base rate', () => {
    expect(
      sampleTrace({ name: 'POST /nwc/request', inheritOrSampleWith })
    ).toBe(0.05)
    expect(
      sampleTrace({ name: 'POST /nwc/request', inheritOrSampleWith: () => 1 })
    ).toBe(1)
  })
})

describe('log scrubbing', () => {
  it('redacts PII from log messages and attributes before sending', () => {
    initSentry({ SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' } as ListenerEnv)
    const { beforeSendLog } = vi.mocked(Sentry.init).mock.calls.at(-1)![0]!
    const secret = 'nostr+walletconnect://abc?secret=def'
    const log = beforeSendLog!({
      level: 'warn',
      message: `failed ${secret}`,
      attributes: { uri: secret, err: { message: secret }, attempt: 3 }
    })!
    expect(JSON.stringify(log)).not.toContain('walletconnect')
    expect(log.attributes?.attempt).toBe(3)
  })
})

describe('event scrubbing', () => {
  it('redacts PII from message, exception values and breadcrumbs', () => {
    initSentry({ SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' } as ListenerEnv)
    const { beforeSend } = vi.mocked(Sentry.init).mock.calls.at(-1)![0]!
    const secret = 'nostr+walletconnect://abc?secret=def'
    const event = beforeSend!(
      {
        type: undefined,
        message: secret,
        exception: { values: [{ value: secret }, {}] },
        breadcrumbs: [{ message: secret }, {}]
      },
      {}
    )
    expect(JSON.stringify(event)).not.toContain('walletconnect')
  })
})

describe('shutdown', () => {
  it('ends the session and flushes once initialized', async () => {
    initSentry({ SENTRY_DSN: 'https://k@o.ingest.sentry.io/1' } as ListenerEnv)
    endSentrySession()
    await flushSentry(10)
    expect(Sentry.endSession).toHaveBeenCalled()
    expect(Sentry.flush).toHaveBeenCalledWith(10)
  })

  it('swallows SDK failures on shutdown', async () => {
    vi.mocked(Sentry.endSession).mockImplementationOnce(() => {
      throw new Error('x')
    })
    vi.mocked(Sentry.flush).mockRejectedValueOnce(new Error('x'))
    expect(() => endSentrySession()).not.toThrow()
    await expect(flushSentry(10)).resolves.toBeUndefined()
  })
})
