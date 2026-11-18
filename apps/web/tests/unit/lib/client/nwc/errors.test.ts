import { describe, expect, it } from 'vitest'
import { nwcErrorKind } from '@/lib/client/nwc/errors'

describe('nwcErrorKind', () => {
  it.each([
    ['failed to publish: AggregateError: All promises were rejected', 'relayOffline'],
    ['publish timeout: abc123', 'relayOffline'],
    ['failed to connect to any relay', 'relayOffline'],
    ['reply timeout: event abc123', 'timeout'],
    ['Failed to request get_balance', 'timeout'],
    ['insufficient balance', null]
  ])('%s → %s', (message, kind) => {
    expect(nwcErrorKind(new Error(message))).toBe(kind)
  })
})
