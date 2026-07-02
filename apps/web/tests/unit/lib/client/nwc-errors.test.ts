import { describe, it, expect } from 'vitest'
import { describeNwcError } from '@/lib/client/nwc/errors'

describe('describeNwcError', () => {
  it('maps the "all relays rejected" publish failure to a relay-offline message', () => {
    const err = new Error('failed to publish: AggregateError: All promises were rejected')
    expect(describeNwcError(err)).toMatch(/relay looks offline/i)
  })

  it('maps "failed to connect to any relay" to the relay-offline message', () => {
    expect(describeNwcError(new Error('failed to connect to any relay'))).toMatch(
      /relay looks offline/i
    )
  })

  it('maps request timeouts to a "did not respond" message', () => {
    expect(describeNwcError(new Error('Failed to request get_balance'))).toMatch(
      /did.?n.?t respond/i
    )
  })

  it('passes genuine wallet errors through unchanged', () => {
    expect(describeNwcError(new Error('insufficient balance'))).toBe('insufficient balance')
  })

  it('handles non-Error values', () => {
    expect(describeNwcError(null)).toBeTruthy()
    expect(describeNwcError('some string')).toBe('some string')
  })
})
