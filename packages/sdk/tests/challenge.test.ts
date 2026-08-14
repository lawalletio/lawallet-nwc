import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey
} from 'nostr-tools/pure'
import { describe, expect, it, vi } from 'vitest'
import {
  CHALLENGE_EVENT_KIND,
  LaWalletError,
  generateSigner,
  signChallengeEvent,
  verifyChallengeEvent
} from '../src'

const NONCE = 'a-server-issued-nonce'

describe('proof of key control', () => {
  it('round-trips a signed challenge', async () => {
    const { signer, pubkey } = generateSigner()

    const event = await signChallengeEvent(NONCE, signer)

    expect(event.kind).toBe(CHALLENGE_EVENT_KIND)
    expect(event.tags).toContainEqual(['challenge', NONCE])
    expect(verifyChallengeEvent(event, NONCE)).toBe(pubkey)
    expect(verifyChallengeEvent(event, NONCE, pubkey)).toBe(pubkey)
  })

  it('rejects a proof for a different challenge', async () => {
    const { signer } = generateSigner()
    const event = await signChallengeEvent(NONCE, signer)

    const error = expectThrow(() => verifyChallengeEvent(event, 'other-nonce'))
    expect(error.code).toBe('PROOF_CHALLENGE_MISMATCH')
    expect(error.status).toBe(401)
  })

  it('rejects a proof signed by an unexpected key', async () => {
    const { signer } = generateSigner()
    const other = generateSigner()
    const event = await signChallengeEvent(NONCE, signer)

    const error = expectThrow(() =>
      verifyChallengeEvent(event, NONCE, other.pubkey)
    )
    expect(error.code).toBe('PROOF_WRONG_KEY')
  })

  it('rejects a stale proof', async () => {
    const { signer } = generateSigner()
    const event = await signChallengeEvent(NONCE, signer)

    // 400s in the future — beyond the ±300s window either way.
    vi.setSystemTime(new Date((event.created_at + 400) * 1000))
    try {
      const error = expectThrow(() => verifyChallengeEvent(event, NONCE))
      expect(error.code).toBe('PROOF_STALE')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a tampered signature', async () => {
    const { signer } = generateSigner()
    const event = await signChallengeEvent(NONCE, signer)
    // Round-trip through JSON exactly as the event would arrive over the
    // wire: nostr-tools caches its verdict in a symbol property that an
    // object spread would carry over, masking the tamper.
    const flipped = JSON.parse(JSON.stringify(event))
    flipped.sig =
      flipped.sig.slice(0, -2) + (flipped.sig.endsWith('00') ? '11' : '00')

    const error = expectThrow(() => verifyChallengeEvent(flipped, NONCE))
    expect(error.code).toBe('PROOF_BAD_SIGNATURE')
  })

  it('rejects a validly signed event of the wrong kind', async () => {
    // A note the user posted elsewhere must not double as an auth proof.
    const secretKey = generateSecretKey()
    const note = finalizeEvent(
      {
        kind: 1,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['challenge', NONCE]],
        content: ''
      },
      secretKey
    )
    expect(note.pubkey).toBe(getPublicKey(secretKey))

    const error = expectThrow(() => verifyChallengeEvent(note, NONCE))
    expect(error.code).toBe('PROOF_WRONG_KIND')
    expect(error.status).toBe(400)
  })
})

function expectThrow(fn: () => unknown): LaWalletError {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(LaWalletError)
    return error as LaWalletError
  }
  throw new Error('Expected verifyChallengeEvent to throw')
}
