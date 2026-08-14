import { describe, expect, it, vi } from 'vitest'
import {
  CHALLENGE_TTL_SECONDS,
  mintChallenge,
  openChallenge
} from './challenge'

const SECRET = 'test-secret'
const PUBKEY = 'a'.repeat(64)

describe('stateless challenges', () => {
  it('round-trips the pubkey and nonce', () => {
    const { challenge, nonce, expiresIn } = mintChallenge(PUBKEY, SECRET)

    expect(expiresIn).toBe(CHALLENGE_TTL_SECONDS)
    expect(openChallenge(challenge, SECRET)).toEqual({ pubkey: PUBKEY, nonce })
  })

  it('rejects a tampered payload', () => {
    const { challenge } = mintChallenge(PUBKEY, SECRET)
    // Swap in another pubkey while keeping the original HMAC.
    const [exp, , nonce, mac] = challenge.split('.')
    const forged = [exp, 'b'.repeat(64), nonce, mac].join('.')

    expect(() => openChallenge(forged, SECRET)).toThrow(/signature is invalid/)
  })

  it('rejects a challenge minted with a different secret', () => {
    const { challenge } = mintChallenge(PUBKEY, SECRET)
    expect(() => openChallenge(challenge, 'other-secret')).toThrow(
      /signature is invalid/
    )
  })

  it('rejects an expired challenge', () => {
    const { challenge } = mintChallenge(PUBKEY, SECRET)

    vi.setSystemTime(new Date(Date.now() + (CHALLENGE_TTL_SECONDS + 5) * 1000))
    try {
      expect(() => openChallenge(challenge, SECRET)).toThrow(/expired/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects malformed input', () => {
    expect(() => openChallenge('nonsense', SECRET)).toThrow(/Malformed/)
  })
})
