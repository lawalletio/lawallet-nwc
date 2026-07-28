import { describe, expect, it } from 'vitest'
import { bech32 } from 'bech32'
import { finalizeEvent } from 'nostr-tools/pure'
import { receiptPubkey, validateZapRequest } from '@/lib/proxy/nostr'

const senderKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const recipientKey = 'ab'.repeat(32)
const lnurlUrl = 'https://pay.example/.well-known/lnurlp/alice'
const encodedLnurl = bech32.encode(
  'lnurl',
  bech32.toWords(new TextEncoder().encode(lnurlUrl)),
  2048
)

function zapRequest(overrides: { amount?: string; lnurl?: string } = {}) {
  return finalizeEvent(
    {
      kind: 9734,
      created_at: 1_700_000_000,
      content: 'hello',
      tags: [
        ['p', recipientKey],
        ['amount', overrides.amount ?? '100000'],
        ['lnurl', overrides.lnurl ?? encodedLnurl],
        ['relays', 'wss://relay.example']
      ]
    },
    senderKey
  )
}

describe('proxy NIP-57 validation', () => {
  it('accepts a valid signed zap request for this recipient, amount, and LNURL', () => {
    const event = zapRequest()
    const raw = JSON.stringify(event)
    const result = validateZapRequest({
      raw,
      amountMsats: 100_000,
      recipientPubkey: recipientKey,
      expectedLnurl: lnurlUrl,
      nowSeconds: 1_700_000_000
    })
    expect(result.canonicalJson).toBe(raw)
    expect(result.relays).toEqual(['wss://relay.example'])
  })

  it('rejects a zap request for a different amount or LNURL', () => {
    expect(() =>
      validateZapRequest({
        raw: JSON.stringify(zapRequest({ amount: '99999' })),
        amountMsats: 100_000,
        recipientPubkey: recipientKey,
        expectedLnurl: lnurlUrl,
        nowSeconds: 1_700_000_000
      })
    ).toThrow(/amount/)

    expect(() =>
      validateZapRequest({
        raw: JSON.stringify(zapRequest({ lnurl: encodedLnurl.slice(0, -1) })),
        amountMsats: 100_000,
        recipientPubkey: recipientKey,
        expectedLnurl: lnurlUrl,
        nowSeconds: 1_700_000_000
      })
    ).toThrow(/LNURL/)
  })

  it('derives the advertised receipt pubkey from the signer', () => {
    expect(receiptPubkey(Buffer.from(senderKey).toString('hex'))).toHaveLength(
      64
    )
  })
})
