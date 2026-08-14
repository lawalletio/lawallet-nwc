import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Stateless proof-of-control challenges.
 *
 * The challenge carries everything needed to verify it later — expiry, the
 * pubkey it was issued for, and a nonce — authenticated by an HMAC. No
 * database, no in-memory map, so it survives a restart on any instance count.
 *
 * ponytail: not single-use. Within the 300s TTL the same proof can be replayed
 * to provision a SECOND address for the same (already proven) pubkey — the
 * same trade-off LaWallet itself documents for its link challenges. If that
 * matters, keep a used-nonce Set (single process) or a table (multi-process).
 */

/** Matches the ±300s skew the proof event itself is checked against. */
export const CHALLENGE_TTL_SECONDS = 300

export interface OpenedChallenge {
  pubkey: string
  nonce: string
}

const sign = (secret: string, payload: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url')

/** Issues a challenge bound to `pubkey`, so another key cannot answer it. */
export function mintChallenge(
  pubkey: string,
  secret: string
): { challenge: string; nonce: string; expiresIn: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + CHALLENGE_TTL_SECONDS
  const nonce = randomBytes(32).toString('base64url')
  const payload = `${expiresAt}.${pubkey}.${nonce}`
  return {
    challenge: `${payload}.${sign(secret, payload)}`,
    nonce,
    expiresIn: CHALLENGE_TTL_SECONDS
  }
}

/** Verifies + unpacks a challenge. Throws if tampered, malformed or expired. */
export function openChallenge(
  challenge: string,
  secret: string
): OpenedChallenge {
  const parts = challenge.split('.')
  if (parts.length !== 4) throw new Error('Malformed challenge')

  const [expiresAt, pubkey, nonce, mac] = parts
  const expected = sign(secret, `${expiresAt}.${pubkey}.${nonce}`)

  const provided = Buffer.from(mac)
  const wanted = Buffer.from(expected)
  if (provided.length !== wanted.length || !timingSafeEqual(provided, wanted)) {
    throw new Error('Challenge signature is invalid')
  }

  if (Number(expiresAt) < Math.floor(Date.now() / 1000)) {
    throw new Error('Challenge has expired')
  }

  return { pubkey, nonce }
}
