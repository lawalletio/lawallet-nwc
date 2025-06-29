import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'

export function generatePrivateKey(): string {
  const secretKey = generateSecretKey()
  return bytesToHex(secretKey)
}

export function getPublicKeyFromPrivate(privateKeyHex: string): string {
  const privateKeyBytes = hexToBytes(privateKeyHex)
  const publicKeyBytes = getPublicKey(privateKeyBytes)
  return bytesToHex(publicKeyBytes)
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

function hexToBytes(hex: string): Uint8Array {
  if (typeof hex !== 'string') {
    throw new Error('Input must be a string')
  }

  // Remove any whitespace and ensure even length
  const cleanHex = hex.replace(/\s/g, '')
  if (cleanHex.length % 2 !== 0) {
    throw new Error('Hex string must have even length')
  }

  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let i = 0; i < cleanHex.length; i += 2) {
    const byte = Number.parseInt(cleanHex.substr(i, 2), 16)
    if (isNaN(byte)) {
      throw new Error('Invalid hex character')
    }
    bytes[i / 2] = byte
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
