import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from 'node:crypto'
import { getConfig } from '../config/index.js'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

let cachedKey: Buffer | null = null

function getKey(): Buffer {
  if (cachedKey) return cachedKey
  const b64 = getConfig().security.masterKeyBase64
  const key = Buffer.from(b64, 'base64')
  if (key.length !== 32) {
    throw new Error(
      `NT_MASTER_KEY must decode to 32 bytes (got ${key.length}). Generate with: openssl rand -base64 32`
    )
  }
  cachedKey = key
  return key
}

/**
 * Encrypts plaintext with AES-256-GCM. Returned string is
 * `base64(iv) . base64(ciphertext) . base64(authTag)` joined by ':'.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()
  return [
    iv.toString('base64'),
    ciphertext.toString('base64'),
    tag.toString('base64')
  ].join(':')
}

export function decryptSecret(envelope: string): string {
  const parts = envelope.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret envelope')
  }
  const [ivB64, ctB64, tagB64] = parts
  const iv = Buffer.from(ivB64, 'base64')
  const ct = Buffer.from(ctB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('Invalid envelope byte lengths')
  }
  const decipher = createDecipheriv(ALGO, getKey(), iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()])
  return plaintext.toString('utf8')
}
