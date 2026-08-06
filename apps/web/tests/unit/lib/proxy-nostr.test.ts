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

function zapRequest(
  overrides: { amount?: string; lnurl?: string | null } = {}
) {
  const lnurl = 'lnurl' in overrides ? overrides.lnurl : encodedLnurl
  return finalizeEvent(
    {
      kind: 9734,
      created_at: 1_700_000_000,
      content: 'hello',
      tags: [
        ['p', recipientKey],
        ['amount', overrides.amount ?? '100000'],
        ...(lnurl ? [['lnurl', lnurl]] : []),
        ['relays', 'wss://relay.example']
      ]
    },
    senderKey
  )
}

/** Runs validation with the fixture's recipient and amount expectations. */
function validate(overrides: { amount?: string; lnurl?: string | null } = {}) {
  return validateZapRequest({
    raw: JSON.stringify(zapRequest(overrides)),
    amountMsats: 100_000,
    nowSeconds: 1_700_000_000
  })
}

describe('proxy NIP-57 validation', () => {
  it('accepts a valid signed zap request for this recipient and amount', () => {
    const event = zapRequest()
    const raw = JSON.stringify(event)
    const result = validateZapRequest({
      raw,
      amountMsats: 100_000,
      nowSeconds: 1_700_000_000
    })
    expect(result.canonicalJson).toBe(raw)
    expect(result.relays).toEqual(['wss://relay.example'])
  })

  it('rejects a zap request for a different amount', () => {
    expect(() => validate({ amount: '99999' })).toThrow(/amount/)
  })

  // The `lnurl` tag is informational: optional in NIP-57, spelled
  // inconsistently by clients, and one address is reachable at several origins.
  // It never decides where funds go, so it is accepted in any shape.
  it('accepts any lnurl tag, or none at all', () => {
    for (const lnurl of [
      null,
      encodedLnurl,
      lnurlUrl,
      'alice@pay.example',
      'http://localhost:3584/.well-known/lnurlp/alice',
      'https://evil.example/.well-known/lnurlp/bob',
      'not-a-url'
    ]) {
      expect(validate({ lnurl }).event.kind).toBe(9734)
    }
  })

  // NIP-57 does not tie `p` to the address owner, so any well-formed pubkey is
  // accepted and copied through to the receipt.
  it('accepts a p tag for any profile, but requires it to be well formed', () => {
    const withP = (pubkey: string) =>
      JSON.stringify(
        finalizeEvent(
          {
            kind: 9734,
            created_at: 1_700_000_000,
            content: 'hello',
            tags: [
              ['p', pubkey],
              ['amount', '100000'],
              ['relays', 'wss://relay.example']
            ]
          },
          senderKey
        )
      )
    const run = (pubkey: string) =>
      validateZapRequest({
        raw: withP(pubkey),
        amountMsats: 100_000,
        nowSeconds: 1_700_000_000
      })

    expect(run('cd'.repeat(32)).event.kind).toBe(9734)
    expect(() => run('not-a-pubkey')).toThrow(/p tag/)
  })

  it('derives the advertised receipt pubkey from the signer', () => {
    expect(receiptPubkey(Buffer.from(senderKey).toString('hex'))).toHaveLength(
      64
    )
  })
})
