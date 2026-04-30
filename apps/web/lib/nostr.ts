import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'

/**
 * @returns A freshly-generated 32-byte Nostr secret key as lowercase hex.
 */
export function generatePrivateKey(): string {
  const secretKey = generateSecretKey()
  return bytesToHex(secretKey)
}

/**
 * Derives the secp256k1 x-only public key for a hex secret key.
 */
export function getPublicKeyFromPrivate(privateKeyHex: string): string {
  const privateKeyBytes = hexToBytes(privateKeyHex)
  return getPublicKey(privateKeyBytes)
}

/**
 * Encodes a hex secret key as a NIP-19 `nsec` string.
 */
export function hexToNsec(privateKeyHex: string): string {
  const privateKeyBytes = hexToBytes(privateKeyHex)
  return nip19.nsecEncode(privateKeyBytes)
}

/**
 * Decodes a NIP-19 `nsec` to a hex secret key.
 *
 * @throws {Error} `'Invalid nsec format'` when the bech32 prefix is not `nsec`.
 */
export function nsecToHex(nsec: string): string {
  const { type, data } = nip19.decode(nsec)
  if (type !== 'nsec') {
    throw new Error('Invalid nsec format')
  }
  return bytesToHex(data as Uint8Array)
}

/** True when `nsec` decodes as a NIP-19 nsec without throwing. */
export function validateNsec(nsec: string): boolean {
  try {
    const { type } = nip19.decode(nsec)
    return type === 'nsec'
  } catch {
    return false
  }
}

/** True when `hex` is exactly 64 lowercase hex chars. */
export function validateHexPrivateKey(hex: string): boolean {
  return /^[0-9a-f]{64}$/.test(hex)
}

/** True when `key` is either a valid nsec or a valid 64-char hex secret key. */
export function validatePrivateKey(key: string): boolean {
  return validateNsec(key) || validateHexPrivateKey(key)
}

/**
 * Normalises a secret key (hex or nsec) to lowercase hex.
 * Assumes `key` already passed {@link validatePrivateKey}.
 */
export function privateKeyToHex(key: string): string {
  if (validateHexPrivateKey(key)) {
    return key
  }
  return nsecToHex(key)
}

/**
 * Parses a NIP-46 `bunker://` URL into its components.
 *
 * @returns Remote signer pubkey, the list of relays to use, and the optional
 *   one-time secret used to authorise the initial connect.
 * @throws {Error} `'Invalid bunker URL'` when the pubkey or relays are missing.
 */
export function parseBunkerUrl(url: string) {
  const u = new URL(url)
  const remoteUserPubkey = u.hostname // hex
  const relays = u.searchParams.getAll('relay')
  const secret = u.searchParams.get('secret') ?? undefined
  if (!remoteUserPubkey || relays.length === 0) {
    throw new Error('Invalid bunker URL')
  }
  return { remoteUserPubkey, relays, secret }
}
