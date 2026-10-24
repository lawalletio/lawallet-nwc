import {
  classifyPasskeyHandle,
  encodeDerivedHandle,
  encodeStoredHandle
} from '@nostr-wot/identity/vault'
export { classifyPasskeyHandle } from '@nostr-wot/identity/vault'
export type { PasskeyHandleClass } from '@nostr-wot/identity/vault'

const LAWALLET_PARAMETER_SET = 2
export const LAWALLET_PASSKEY_PARAMETERS = {
  id: LAWALLET_PARAMETER_SET,
  saltLabel: 'lawallet-nsec-prf-v1',
  infoLabel: 'lawallet-nsec-v1'
}
export const createDerivedHandle = () =>
  Uint8Array.from(encodeDerivedHandle(LAWALLET_PASSKEY_PARAMETERS))
export const createStoredHandle = (pubkey: string) =>
  Uint8Array.from(encodeStoredHandle(pubkey))

/**
 * Whether LaWallet may derive its key from this passkey: a tagged 0x02
 * handle, or an untagged one (older LaWallet passkeys have a UUID handle).
 * Anything else belongs to another app or holds a stored key.
 */
export function isLaWalletHandle(handle: Uint8Array | null): boolean {
  const kind = classifyPasskeyHandle(handle)
  return kind.mode === 'derived'
    ? kind.parameterSet === LAWALLET_PARAMETER_SET
    : kind.mode === 'unknown'
}

/**
 * The author of a tagged stored handle, or null for every other handle.
 * Only tagged stored passkeys sign in to LaWallet without derivation.
 */
export function storedHandleAuthor(handle: Uint8Array | null): string | null {
  const kind = classifyPasskeyHandle(handle)
  return kind.mode === 'stored' && !('legacy' in kind) ? kind.author : null
}
