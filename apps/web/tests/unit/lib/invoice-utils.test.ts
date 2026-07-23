import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import b11 from 'bolt11'
import {
  ExpiredCardPaymentInvoiceError,
  parseCardPaymentInvoice
} from '@/lib/invoice-utils'

/**
 * Builds a real signed bolt11 invoice. `expirySeconds` is the BOLT-11 `x` tag
 * duration (null omits the optional tag); `ageSeconds` backdates the invoice
 * timestamp so expiry boundaries can be exercised without faking the clock.
 */
function makeInvoice({
  satoshis = 100,
  expirySeconds = 3600,
  ageSeconds = 0
}: {
  satoshis?: number
  expirySeconds?: number | null
  ageSeconds?: number
} = {}): string {
  const tags: { tagName: string; data: string | number }[] = [
    { tagName: 'payment_hash', data: crypto.randomBytes(32).toString('hex') },
    { tagName: 'payment_secret', data: crypto.randomBytes(32).toString('hex') },
    { tagName: 'description', data: 'card tap' }
  ]
  if (expirySeconds !== null) {
    tags.push({ tagName: 'expire_time', data: expirySeconds })
  }

  const encoded = b11.encode({
    satoshis,
    timestamp: Math.floor(Date.now() / 1000) - ageSeconds,
    tags
  })

  const { paymentRequest } = b11.sign(encoded, crypto.randomBytes(32))
  if (!paymentRequest) throw new Error('failed to sign test invoice')
  return paymentRequest
}

describe('parseCardPaymentInvoice', () => {
  describe('expiry', () => {
    // Regression: `decoded.expiry` from light-bolt11-decoder is the tag's
    // DURATION, not an absolute timestamp. Treating it as absolute placed
    // every expiry in 1970 and rejected every real tap as expired.
    it('accepts a fresh invoice carrying an explicit expiry tag', () => {
      const invoice = parseCardPaymentInvoice(
        makeInvoice({ expirySeconds: 3600 })
      )

      expect(invoice.expiresAt).toBeGreaterThan(Date.now())
    })

    it('resolves expiry as timestamp + expiry tag', () => {
      const bolt11 = makeInvoice({ expirySeconds: 600, ageSeconds: 60 })
      const invoice = parseCardPaymentInvoice(bolt11)

      // Issued 60s ago with a 600s lifetime => ~540s of life remaining.
      const remainingSeconds = (invoice.expiresAt - Date.now()) / 1000
      expect(remainingSeconds).toBeGreaterThan(530)
      expect(remainingSeconds).toBeLessThan(545)
    })

    it('accepts a short-lived invoice that is still within its window', () => {
      const invoice = parseCardPaymentInvoice(
        makeInvoice({ expirySeconds: 60 })
      )

      expect(invoice.expiresAt).toBeGreaterThan(Date.now())
    })

    it('defaults to a one-hour lifetime when the expiry tag is absent', () => {
      const bolt11 = makeInvoice({ expirySeconds: null })
      const invoice = parseCardPaymentInvoice(bolt11)

      const remainingSeconds = (invoice.expiresAt - Date.now()) / 1000
      expect(remainingSeconds).toBeGreaterThan(3590)
      expect(remainingSeconds).toBeLessThan(3605)
    })

    it('rejects an invoice past its explicit expiry tag', () => {
      const bolt11 = makeInvoice({ expirySeconds: 60, ageSeconds: 120 })

      expect(() => parseCardPaymentInvoice(bolt11)).toThrow(
        ExpiredCardPaymentInvoiceError
      )
    })

    it('rejects an invoice past the default lifetime when no tag is present', () => {
      const bolt11 = makeInvoice({ expirySeconds: null, ageSeconds: 7200 })

      expect(() => parseCardPaymentInvoice(bolt11)).toThrow(
        ExpiredCardPaymentInvoiceError
      )
    })

    it('carries the decoded invoice on the expiry error so retries reconcile', () => {
      const bolt11 = makeInvoice({ expirySeconds: 60, ageSeconds: 120 })

      try {
        parseCardPaymentInvoice(bolt11)
        expect.unreachable('expected an expiry error')
      } catch (error) {
        expect(error).toBeInstanceOf(ExpiredCardPaymentInvoiceError)
        const { invoice } = error as ExpiredCardPaymentInvoiceError
        expect(invoice.bolt11).toBe(bolt11)
        expect(invoice.paymentHash).toMatch(/^[0-9a-f]{64}$/)
        expect(invoice.amountSats).toBe(100)
      }
    })
  })

  describe('decoding', () => {
    it('extracts amount and payment hash', () => {
      const invoice = parseCardPaymentInvoice(makeInvoice({ satoshis: 250 }))

      expect(invoice.amountSats).toBe(250)
      expect(invoice.amountMsats).toBe(250_000)
      expect(invoice.paymentHash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('rejects an undecodable invoice', () => {
      expect(() => parseCardPaymentInvoice('not-an-invoice')).toThrow(
        'Invalid Lightning invoice'
      )
    })
  })
})
