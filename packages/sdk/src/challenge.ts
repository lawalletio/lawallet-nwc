import { verifyEvent, type NostrEvent } from 'nostr-tools/pure'
import { LaWalletError } from './errors'
import type { NostrSigner } from './signer'

/**
 * Proof of key control: the holder of an npub signs a server-issued nonce.
 *
 * The format matches what LaWallet itself uses for account-identity linking
 * and passkey registration (`lib/account/proof.ts`), so a proof produced here
 * is verifiable there and vice versa.
 */

/** NIP-42 client-auth kind, reused across LaWallet as the proof format. */
export const CHALLENGE_EVENT_KIND = 22242

/** Max clock skew accepted on a proof event, mirroring the server. */
export const CHALLENGE_MAX_SKEW_SECONDS = 300

/** Signs the kind-22242 answer to a server-issued nonce. */
export async function signChallengeEvent(
  nonce: string,
  signer: NostrSigner
): Promise<NostrEvent> {
  return signer.signEvent({
    kind: CHALLENGE_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['challenge', nonce]],
    content: ''
  })
}

/**
 * Server half: checks that `event` is a fresh, validly signed answer to
 * `nonce`, and returns the pubkey it proves control of. Pass
 * `expectedPubkey` to pin the proof to one key.
 *
 * Checks run in the same order as the LaWallet server so failures are
 * reported identically. Throws {@link LaWalletError} with an HTTP-shaped
 * status, so a backend can map it straight onto a response.
 */
export function verifyChallengeEvent(
  event: NostrEvent,
  nonce: string,
  expectedPubkey?: string
): string {
  if (event?.kind !== CHALLENGE_EVENT_KIND) {
    throw new LaWalletError(
      400,
      `Proof event must be kind ${CHALLENGE_EVENT_KIND} (NIP-42 auth)`,
      'PROOF_WRONG_KIND'
    )
  }

  const challengeTag = event.tags?.find(tag => tag[0] === 'challenge')?.[1]
  if (!challengeTag || challengeTag !== nonce) {
    throw new LaWalletError(
      401,
      'Proof event does not answer this challenge',
      'PROOF_CHALLENGE_MISMATCH'
    )
  }

  const skew = Math.abs(Math.floor(Date.now() / 1000) - event.created_at)
  if (skew > CHALLENGE_MAX_SKEW_SECONDS) {
    throw new LaWalletError(
      401,
      'Proof event timestamp is too old',
      'PROOF_STALE'
    )
  }

  // `verifyEvent` is handed a freshly built object rather than the caller's:
  // nostr-tools memoizes its verdict on the event under a symbol key, and an
  // object that already carries a `true` there short-circuits the check
  // entirely. This is an exported API taking an event object, so unlike the
  // server routes — which only ever see JSON-parsed bodies, and JSON can't
  // carry a symbol — a consumer really can hand over an in-memory event that
  // `finalizeEvent` or an earlier `verifyEvent` already stamped. Rebuilding
  // from exactly the signed fields costs one object literal.
  const candidate = {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig
  } as NostrEvent
  if (!verifyEvent(candidate)) {
    throw new LaWalletError(
      401,
      'Proof event signature is invalid',
      'PROOF_BAD_SIGNATURE'
    )
  }

  if (expectedPubkey && event.pubkey !== expectedPubkey) {
    throw new LaWalletError(
      401,
      'Proof event was signed by a different key',
      'PROOF_WRONG_KEY'
    )
  }

  return event.pubkey
}
