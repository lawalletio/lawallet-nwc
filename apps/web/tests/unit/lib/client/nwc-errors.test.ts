import { describe, it, expect } from 'vitest'
import en from '@/lib/client/i18n/en'
import es from '@/lib/client/i18n/es'
import { errorText, nwcErrorText } from '@/lib/client/i18n/errors'
import { DestinationParseError } from '@/lib/client/nwc/parse-destination'
import { LnurlError } from '@/lib/client/lnurl-scan'
import { PasskeyError } from '@/lib/client/passkey-api'

describe('nwcErrorText', () => {
  it('maps the "all relays rejected" publish failure to a relay-offline message', () => {
    const err = new Error(
      'failed to publish: AggregateError: All promises were rejected'
    )
    expect(nwcErrorText(en, err)).toMatch(/relay looks offline/i)
  })

  it('maps "failed to connect to any relay" to the relay-offline message', () => {
    expect(
      nwcErrorText(en, new Error('failed to connect to any relay'))
    ).toMatch(/relay looks offline/i)
  })

  it('maps request timeouts to a "did not respond" message', () => {
    expect(
      nwcErrorText(en, new Error('Failed to request get_balance'))
    ).toMatch(/did.?n.?t respond/i)
    expect(nwcErrorText(es, new Error('Failed to request get_balance'))).toBe(
      es.errors.nwc.timeout
    )
  })

  it('passes genuine wallet errors through unchanged', () => {
    expect(nwcErrorText(es, new Error('insufficient balance'))).toBe(
      'insufficient balance'
    )
  })

  it('falls back for non-Error values', () => {
    expect(nwcErrorText(en, null)).toBe(en.errors.nwc.generic)
  })
})

describe('errorText', () => {
  it('localizes coded lib errors', () => {
    expect(
      errorText(es, new DestinationParseError('empty', 'Enter a recipient'), '')
    ).toBe('Ingresa un destinatario')
    expect(errorText(es, new LnurlError('x', 'withdrawStatus', 502), '')).toBe(
      'El servicio de retiro respondió 502'
    )
    expect(errorText(es, new PasskeyError('cancelled', 'x'), '')).toBe(
      es.auth.passkeyErrors.cancelled
    )
  })

  it('never translates service- or server-authored messages', () => {
    expect(errorText(es, new LnurlError('Voucher already used'), '')).toBe(
      'Voucher already used'
    )
    expect(errorText(es, new PasskeyError('unknown', 'Boom'), '')).toBe('Boom')
    const conflict = new PasskeyError('duplicate', 'Already registered')
    conflict.fromServer = true
    expect(errorText(es, conflict, '')).toBe('Already registered')
  })

  it('keeps English identical to the lib messages', () => {
    const err = new LnurlError('LNURL endpoint returned 404', 'httpStatus', 404)
    expect(errorText(en, err, '')).toBe(err.message)
  })
})
