import { nip04, nip44 } from 'nostr-tools'
import { hexToBytes } from 'nostr-tools/utils'

/**
 * Decrypts NWC (kind-23196/23197) or control-plane (kind-4) encrypted
 * content. Tries NIP-44 v2 first (current NWC spec, current DM spec), falls
 * back to NIP-04 (legacy DMs, legacy NWC).
 *
 * Throws only when both fail.
 */
export function decryptWithFallback(
  ourSecretHex: string,
  counterpartyPubkey: string,
  ciphertext: string
): string {
  const secretBytes = hexToBytes(ourSecretHex)
  try {
    const conv = nip44.v2.utils.getConversationKey(
      secretBytes,
      counterpartyPubkey
    )
    return nip44.v2.decrypt(ciphertext, conv)
  } catch (nip44Err) {
    try {
      return nip04.decrypt(ourSecretHex, counterpartyPubkey, ciphertext)
    } catch (nip04Err) {
      throw new Error(
        `Decryption failed (NIP-44: ${(nip44Err as Error).message}; NIP-04: ${(nip04Err as Error).message})`
      )
    }
  }
}

export function encryptNip44(
  ourSecretHex: string,
  counterpartyPubkey: string,
  plaintext: string
): string {
  const secretBytes = hexToBytes(ourSecretHex)
  const conv = nip44.v2.utils.getConversationKey(
    secretBytes,
    counterpartyPubkey
  )
  return nip44.v2.encrypt(plaintext, conv)
}

export function encryptNip04(
  ourSecretHex: string,
  counterpartyPubkey: string,
  plaintext: string
): string {
  return nip04.encrypt(ourSecretHex, counterpartyPubkey, plaintext)
}
