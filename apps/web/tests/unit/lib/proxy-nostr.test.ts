import { describe, expect, it } from 'vitest'
import { bech32 } from 'bech32'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import {
  createZapReceipt,
  receiptPubkey,
  validateZapRequest
} from '@/lib/proxy/nostr'

const senderKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const recipientKey = 'ab'.repeat(32)
const lnurlUrl = 'https://pay.example/.well-known/lnurlp/alice'
const encodedLnurl = bech32.encode(
  'lnurl',
  bech32.toWords(new TextEncoder().encode(lnurlUrl)),
  2048
)

function zapRequest(
  overrides: {
    amount?: string
    lnurl?: string | null
    extraTags?: string[][]
  } = {}
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
        ['relays', 'wss://relay.example'],
        ...(overrides.extraTags ?? [])
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

  it('rejects a tampered signature', () => {
    // `validateZapRequest` takes the raw string and parses it itself, so the
    // event it verifies can never carry nostr-tools' `verifiedSymbol` cache —
    // JSON.stringify drops symbol-keyed properties on the way in. This pins
    // that the signature is genuinely re-checked rather than memoized.
    const event = zapRequest()
    const sig = event.sig.slice(0, -1) + (event.sig.endsWith('a') ? 'b' : 'a')
    expect(() =>
      validateZapRequest({
        raw: JSON.stringify({ ...event, sig }),
        amountMsats: 100_000,
        nowSeconds: 1_700_000_000
      })
    ).toThrow(/signature, kind, or timestamp is invalid/)
  })

  it('rejects tampered content', () => {
    const event = zapRequest()
    expect(() =>
      validateZapRequest({
        raw: JSON.stringify({ ...event, content: 'evil' }),
        amountMsats: 100_000,
        nowSeconds: 1_700_000_000
      })
    ).toThrow(/signature, kind, or timestamp is invalid/)
  })

  it('derives the advertised receipt pubkey from the signer', () => {
    expect(receiptPubkey(Buffer.from(senderKey).toString('hex'))).toHaveLength(
      64
    )
  })
})

const receiptSignerKey = Uint8Array.from(
  { length: 32 },
  (_, index) => index + 50
)

describe('createZapReceipt', () => {
  function receiptFor(request = zapRequest()) {
    return createZapReceipt({
      zapRequest: request,
      zapRequestJson: JSON.stringify(request),
      payerInvoice: 'lnbc1test',
      payerPreimage: 'aa'.repeat(32),
      privateKeyHex: Buffer.from(receiptSignerKey).toString('hex'),
      createdAtSeconds: 1_700_000_100
    })
  }

  it('includes exactly one sender P tag from the zap request pubkey', () => {
    const request = zapRequest()
    const senderPTags = receiptFor(request).tags.filter(tag => tag[0] === 'P')
    expect(senderPTags).toHaveLength(1)
    expect(senderPTags[0]).toEqual(['P', request.pubkey])
    expect(request.pubkey).toBe(getPublicKey(senderKey))
  })

  it('copies recipient p/e/a tags and ignores a request P tag', () => {
    const eventId = 'cd'.repeat(32)
    const addressable = `30023:${recipientKey}:post`
    const request = zapRequest({
      extraTags: [
        ['e', eventId],
        ['a', addressable],
        ['P', 'ff'.repeat(32)]
      ]
    })
    const receipt = receiptFor(request)
    expect(receipt.tags.filter(tag => tag[0] === 'p')).toEqual([
      ['p', recipientKey]
    ])
    expect(receipt.tags).toContainEqual(['e', eventId])
    expect(receipt.tags).toContainEqual(['a', addressable])
    expect(receipt.tags.filter(tag => tag[0] === 'P')).toEqual([
      ['P', request.pubkey]
    ])
  })
})
