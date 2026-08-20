import { describe, it, expect } from 'vitest'
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey
} from 'nostr-tools/pure'
import { verifyVoucherEvent, VOUCHER_EVENT_KIND } from '@/lib/vouchers/event'
import { ValidationError } from '@/types/server/errors'

const serviceKey = generateSecretKey()
const servicePubkey = getPublicKey(serviceKey)
/** `p` on a 20402 is the MERCHANT — the shop that accepts the coupon. */
const merchant = 'b'.repeat(64)
/** A LaWallet member. The protocol has no field for them, by design. */
const recipient = 'f'.repeat(64)
const NONCE = 'hcLPDzERvvHzS4Vn0OLbAQ'

function signVoucher(
  overrides: {
    kind?: number
    tags?: string[][]
  } = {}
) {
  return finalizeEvent(
    {
      kind: overrides.kind ?? VOUCHER_EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: overrides.tags ?? [
        ['nonce', NONCE],
        ['p', merchant],
        ['coupon', '0f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9'],
        ['phase', 'minted'],
        ['expiration', '1764633600']
      ],
      content: JSON.stringify({ v: 1, nonce: NONCE, owner: merchant })
    },
    serviceKey
  )
}

const expected = { merchantPubkey: merchant, nonce: NONCE }

describe('verifyVoucherEvent', () => {
  it('accepts a well-formed event and derives its facts', () => {
    const result = verifyVoucherEvent(signVoucher(), expected)
    expect(result).toEqual({
      servicePubkey,
      merchantPubkey: merchant,
      nonce: NONCE,
      couponId: '0f1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
      expiresAt: 1764633600,
      phase: 'minted'
    })
  })

  it('rejects a tampered signature', () => {
    const event = signVoucher()
    // Flip one character. `verifyEvent` recomputes the id, so this must fail
    // even though every other field still looks correct.
    const sig = `${event.sig.slice(0, -1)}${event.sig.endsWith('a') ? 'b' : 'a'}`
    expect(() => verifyVoucherEvent({ ...event, sig }, expected)).toThrow(
      ValidationError
    )
  })

  it('rejects a voucher naming a different merchant', () => {
    const event = signVoucher({
      tags: [
        ['nonce', NONCE],
        ['p', 'c'.repeat(64)]
      ]
    })
    expect(() => verifyVoucherEvent(event, expected)).toThrow(
      /different merchant/
    )
  })

  it('rejects a voucher whose `p` is the recipient instead of the merchant', () => {
    // Regression: we used to require `p` === the LaWallet member, which meant
    // every genuine CMS-signed voucher was rejected and every voucher we did
    // accept was off-spec. `p` is the merchant; the protocol has no holder.
    const event = signVoucher({
      tags: [
        ['nonce', NONCE],
        ['p', recipient]
      ]
    })
    expect(() => verifyVoucherEvent(event, expected)).toThrow(
      /different merchant/
    )
  })

  it('rejects a tampered tag, because the id no longer matches', () => {
    const event = signVoucher()
    const tags = event.tags.map(tag =>
      tag[0] === 'nonce' ? ['nonce', 'AAAAAAAAAAAAAAAAAAAAAA'] : tag
    )
    expect(() =>
      verifyVoucherEvent(
        { ...event, tags },
        { ...expected, nonce: 'AAAAAAAAAAAAAAAAAAAAAA' }
      )
    ).toThrow(/signature is invalid/)
  })

  it('rejects a nonce that disagrees with the deposit body', () => {
    const event = signVoucher()
    expect(() =>
      verifyVoucherEvent(event, {
        ...expected,
        nonce: 'ZZZZZZZZZZZZZZZZZZZZZZ'
      })
    ).toThrow(/nonce does not match/)
  })

  it('rejects a signer that disagrees with the declared servicePubkey', () => {
    expect(() =>
      verifyVoucherEvent(signVoucher(), {
        ...expected,
        servicePubkey: 'd'.repeat(64)
      })
    ).toThrow(/signer does not match/)
  })

  it('rejects the wrong kind before doing any crypto', () => {
    expect(() =>
      verifyVoucherEvent(signVoucher({ kind: 1 }), expected)
    ).toThrow(/must be kind 20402/)
  })

  it('rejects non-object input', () => {
    expect(() => verifyVoucherEvent(null, expected)).toThrow(ValidationError)
    expect(() => verifyVoucherEvent('nope', expected)).toThrow(ValidationError)
  })
})
