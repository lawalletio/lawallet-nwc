import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureSession: vi.fn(),
  captureException: vi.fn()
}))

import * as Sentry from '@sentry/node'
import type { ListenerEnv } from '../src/env'
import {
  captureException,
  initSentry,
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
