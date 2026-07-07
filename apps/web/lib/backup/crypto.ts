import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * Optional password protection for a backup archive. The zip bytes are wrapped
 * in an AES-256-GCM envelope so a downloaded archive is safe at rest:
 *
 *   magic "LAWBKP01"(8) | salt(16) | iv(12) | authTag(16) | ciphertext
 *
 * The key is derived from the password with scrypt (N=2^15). A wrong password
 * fails the GCM auth-tag check on decrypt, which the caller maps to a
 * `BACKUP_PASSWORD_INVALID` error.
 */

const MAGIC = Buffer.from('LAWBKP01', 'utf8') // 8 bytes
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
// scrypt cost. 2^15 keeps a one-shot admin operation well under a second while
// staying meaningfully expensive to brute-force. maxmem is raised to fit N.
const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 } as const

/** True when `bytes` starts with the backup encryption magic header. */
export function isEncryptedArchive(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN) return false
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) return false
  }
  return true
}

/** Wraps raw archive bytes in the encrypted envelope. */
export function encryptArchive(plain: Uint8Array, password: string): Buffer {
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext])
}

/**
 * Reverses {@link encryptArchive}. Throws if the password is wrong (GCM
 * authentication failure) or the envelope is malformed.
 */
export function decryptArchive(envelope: Uint8Array, password: string): Buffer {
  const buf = Buffer.from(envelope)
  let offset = MAGIC.length
  const salt = buf.subarray(offset, (offset += SALT_LEN))
  const iv = buf.subarray(offset, (offset += IV_LEN))
  const tag = buf.subarray(offset, (offset += TAG_LEN))
  const ciphertext = buf.subarray(offset)
  const key = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
