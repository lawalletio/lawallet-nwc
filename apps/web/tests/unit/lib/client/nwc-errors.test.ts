import { describe, it, expect } from 'vitest'
import en from '@/lib/client/i18n/en'
import es from '@/lib/client/i18n/es'
import { errorText, nwcErrorText } from '@/lib/client/i18n/errors'
import { DestinationParseError } from '@/lib/client/nwc/parse-destination'
import { LnurlError } from '@/lib/client/lnurl-scan'
import { PasskeyError } from '@/lib/client/passkey-api'
import { BoltcardPayError } from '@/lib/client/boltcard-pay'
import { BoltcardNfcError } from '@/lib/client/hooks/use-boltcard-nfc'
import { PaymentInputError } from '@/lib/client/nwc/pay'

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

  it('localizes BoltCard, NFC and payment-input errors', () => {
    const aboveMax = new BoltcardPayError('x', 'aboveMax', {
      limitSats: 10,
      amountSats: 500
    })
    expect(errorText(es, aboveMax, '')).toBe(
      'Esta tarjeta puede pagar hasta 10 sats. Esta factura es de 500 sats.'
    )
    expect(errorText(es, new BoltcardNfcError('noLink'), '')).toBe(
      es.errors.nfc.noLink
    )
    expect(
      errorText(es, new PaymentInputError('npubUnsupported', 'x'), '')
    ).toBe(es.errors.payment.npubUnsupported)
  })

  it('localizes a wrapped LnurlError by its code, else keeps its text', () => {
    const coded = new BoltcardPayError('x', undefined, undefined, {
      cause: new LnurlError('x', 'withdrawStatus', 502)
    })
    expect(errorText(es, coded, '')).toBe('El servicio de retiro respondió 502')
    const reason = new BoltcardPayError(
      'counter value too old',
      undefined,
      undefined,
      {
        cause: new LnurlError('counter value too old')
      }
    )
    expect(errorText(es, reason, '')).toBe('counter value too old')
  })

  it('keeps English identical for the BoltCard and NFC messages', () => {
    const belowMin = new BoltcardPayError(
      `This card's minimum is ${(1000).toLocaleString()} sats. This invoice is ${(500).toLocaleString()} sats.`,
      'belowMin',
      { limitSats: 1000, amountSats: 500 }
    )
    expect(errorText(en, belowMin, '')).toBe(belowMin.message)
    const nfc = new BoltcardNfcError('readError')
    expect(errorText(en, nfc, '')).toBe(nfc.message)
  })
})
