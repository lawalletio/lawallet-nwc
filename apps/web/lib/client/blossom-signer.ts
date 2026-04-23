import type { NostrSigner } from '@nostrify/nostrify'
import type { Signer, EventTemplate, SignedEvent } from 'blossom-client-sdk'

/**
 * Adapts one of our three Nostr signer types (local nsec, NIP-07 browser
 * extension, NIP-46 bunker) to the functional signer signature that
 * `blossom-client-sdk` expects: `(EventTemplate) => Promise<SignedEvent>`.
 *
 * Our auth layer always exposes a `NostrSigner` (the `@nostrify/nostrify`
 * interface), regardless of which login method the user picked:
 *   - `NSecSigner`  — local in-memory nsec.
 *   - `NBrowserSigner` — proxies `window.nostr` (NIP-07).
 *   - wrapped `Nip46Signer` — bunker:// / nostrconnect:// (NIP-46).
 *
 * All three implement `signEvent(event: Omit<NostrEvent,'id'|'pubkey'|'sig'>)
 * → Promise<NostrEvent>`, which is structurally identical to
 * blossom-client-sdk's `Signer`. This helper centralises the adaptation
 * (previously an unsafe `as` cast inline) and adds a runtime shape check so
 * we fail loudly if a signer ever returns something unsigned.
 */
export function toBlossomSigner(signer: NostrSigner): Signer {
  return async (draft: EventTemplate): Promise<SignedEvent> => {
    const event = await signer.signEvent(draft)
    if (
      !event ||
      typeof event.id !== 'string' ||
      typeof event.pubkey !== 'string' ||
      typeof event.sig !== 'string'
    ) {
      throw new Error('Signer returned an unsigned or malformed event')
    }
    return event as SignedEvent
  }
}
