import { randomBytes } from 'crypto'
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure'
import { createJwtToken, verifyJwtToken } from '@/lib/jwt'
import { getConfig } from '@/lib/config'
import {
  AuthenticationError,
  InternalServerError,
  ValidationError
} from '@/types/server/errors'

/** NIP-42 client-authentication event kind, reused as the link-proof format. */
export const LINK_PROOF_EVENT_KIND = 22242

const LINK_CHALLENGE_EXPIRES_IN = 300 // seconds
const MERGE_TICKET_EXPIRES_IN = 600 // seconds
/** Max clock skew accepted on the proof event's created_at. */
const PROOF_EVENT_MAX_SKEW_SECONDS = 300

function jwtSecret(): string {
  const config = getConfig()
  if (!config.jwt.enabled || !config.jwt.secret) {
    throw new InternalServerError('Server configuration error')
  }
  return config.jwt.secret
}

/**
 * Mints a short-lived challenge for the Nostr link proof, bound to the
 * initiating account. The `nonce` travels inside the signed token so verify
 * needs no server-side state.
 *
 * Not single-use by design: replaying a link proof re-attempts the same
 * attach, which is idempotent (P2002 → 409) — and a merge ticket's replay
 * dies with the absorbed account. This keeps the flow stateless, unlike the
 * WebAuthn challenges which gate session minting and stay DB-backed.
 */
export function mintNostrLinkChallenge(accountId: string): {
  challenge: string
  nonce: string
  expiresIn: number
} {
  const nonce = randomBytes(32).toString('base64url')
  const challenge = createJwtToken(
    { userId: accountId, pubkey: '', kind: 'link-challenge', nonce },
    jwtSecret(),
    {
      expiresIn: LINK_CHALLENGE_EXPIRES_IN,
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    }
  )
  return { challenge, nonce, expiresIn: LINK_CHALLENGE_EXPIRES_IN }
}

/**
 * Verifies a NIP-42-style proof event against a minted challenge:
 * the challenge token must be valid and bound to the calling account, the
 * event must be kind 22242, carry the challenge nonce in a `challenge` tag,
 * be fresh, and carry a valid Schnorr signature. Returns the proven pubkey.
 */
export function verifyNostrLinkProof(params: {
  challenge: string
  event: NostrEvent
  accountId: string
}): string {
  const { challenge, event, accountId } = params

  let payload: Record<string, unknown>
  try {
    payload = verifyJwtToken(challenge, jwtSecret(), {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    }).payload
  } catch {
    throw new AuthenticationError('Link challenge is invalid or expired')
  }
  if (payload.kind !== 'link-challenge' || payload.userId !== accountId) {
    throw new AuthenticationError('Link challenge is invalid or expired')
  }

  if (event.kind !== LINK_PROOF_EVENT_KIND) {
    throw new ValidationError('Proof event must be kind 22242 (NIP-42 auth)')
  }
  const challengeTag = event.tags.find(t => t[0] === 'challenge')?.[1]
  if (!challengeTag || challengeTag !== payload.nonce) {
    throw new AuthenticationError('Proof event does not answer this challenge')
  }
  const skew = Math.abs(Math.floor(Date.now() / 1000) - event.created_at)
  if (skew > PROOF_EVENT_MAX_SKEW_SECONDS) {
    throw new AuthenticationError('Proof event timestamp is too old')
  }
  if (!verifyEvent(event)) {
    throw new AuthenticationError('Proof event signature is invalid')
  }

  return event.pubkey
}

export interface MergeTicketClaims {
  /** Account initiating (and surviving) the merge. */
  survivorId: string
  /** Account proven and absorbed by the merge. */
  absorbedId: string
  /** The pubkey whose control was proven. */
  provenPubkey: string
}

/**
 * A merge ticket is the bridge between "proved control of the other account"
 * (link/verify) and the destructive commit (merge). It is bound to BOTH
 * account ids, so neither a different session nor a different target can
 * reuse it, and it expires quickly.
 */
export function mintMergeTicket(claims: MergeTicketClaims): string {
  return createJwtToken(
    {
      userId: claims.survivorId,
      pubkey: claims.provenPubkey,
      kind: 'merge-ticket',
      absorbedId: claims.absorbedId
    },
    jwtSecret(),
    {
      expiresIn: MERGE_TICKET_EXPIRES_IN,
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    }
  )
}

/** Verifies a merge ticket and its binding to the calling (survivor) account. */
export function verifyMergeTicket(
  ticket: string,
  survivorId: string
): MergeTicketClaims {
  let payload: Record<string, unknown>
  try {
    payload = verifyJwtToken(ticket, jwtSecret(), {
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users'
    }).payload
  } catch {
    throw new AuthenticationError('Merge ticket is invalid or expired')
  }
  if (
    payload.kind !== 'merge-ticket' ||
    payload.userId !== survivorId ||
    typeof payload.absorbedId !== 'string' ||
    typeof payload.pubkey !== 'string'
  ) {
    throw new AuthenticationError('Merge ticket is invalid or expired')
  }
  return {
    survivorId,
    absorbedId: payload.absorbedId,
    provenPubkey: payload.pubkey
  }
}
