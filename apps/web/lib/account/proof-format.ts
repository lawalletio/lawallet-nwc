/**
 * Wire format of the "prove you control this Nostr key" event, shared by the
 * browser (which signs it) and the server (which verifies it). Kept free of
 * server-only imports so client bundles can use it.
 *
 * The event reuses NIP-42's kind 22242, but a bare NIP-42 AUTH event is NOT
 * accepted: relays ask clients to sign exactly that shape, often without the
 * user seeing it, so anyone running a relay could collect one for a nonce of
 * their choosing and present it here. The proof is therefore bound to its
 * purpose by `content`, which a relay AUTH event leaves empty, and must not
 * carry NIP-42's `relay` tag.
 */

/** Event kind of the proof (NIP-42 client authentication). */
export const PROOF_EVENT_KIND = 22242

/** What the proven key is being used for; each flow has its own marker. */
export type ProofPurpose = 'link' | 'passkey-registration'

const PROOF_CONTENT: Record<ProofPurpose, string> = {
  link: 'lawallet:link-identity',
  'passkey-registration': 'lawallet:register-passkey'
}

/** The exact `content` a proof for `purpose` must carry. */
export function proofContent(purpose: ProofPurpose): string {
  return PROOF_CONTENT[purpose]
}

/** Unsigned proof event for `purpose`, answering `nonce`. */
export function buildProofEventTemplate(
  purpose: ProofPurpose,
  nonce: string,
  createdAt: number = Math.floor(Date.now() / 1000)
): {
  kind: number
  created_at: number
  tags: string[][]
  content: string
} {
  return {
    kind: PROOF_EVENT_KIND,
    created_at: createdAt,
    tags: [['challenge', nonce]],
    content: proofContent(purpose)
  }
}
