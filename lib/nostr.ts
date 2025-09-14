import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'

export function generatePrivateKey(): string {
  const secretKey = generateSecretKey()
  return bytesToHex(secretKey)
}

export function getPublicKeyFromPrivate(privateKeyHex: string): string {
  const privateKeyBytes = hexToBytes(privateKeyHex)
  return getPublicKey(privateKeyBytes)
}

export function hexToNsec(privateKeyHex: string): string {
  const privateKeyBytes = hexToBytes(privateKeyHex)
  return nip19.nsecEncode(privateKeyBytes)
}

export function nsecToHex(nsec: string): string {
  const { type, data } = nip19.decode(nsec)
  if (type !== 'nsec') {
    throw new Error('Invalid nsec format')
  }
  return bytesToHex(data as Uint8Array)
}

export function validateNsec(nsec: string): boolean {
  try {
    const { type } = nip19.decode(nsec)
    return type === 'nsec'
  } catch {
    return false
  }
}

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
