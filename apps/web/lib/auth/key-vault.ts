import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes
} from 'node:crypto'
import { getConfig } from '@/lib/config'

/**
 * At-rest encryption for server-custodied Nostr secret keys (passkey-native
 * accounts). Each key is wrapped in an AES-256-GCM envelope:
 *
 *   magic "LWKV01"(6) | salt(16) | iv(12) | authTag(16) | ciphertext(32)
 *
 * The per-record key is derived with HKDF-SHA256 from `KEY_VAULT_SECRET` and
 * the envelope's random salt, so the master secret is never used directly as
 * a cipher key and IV reuse across records is a non-issue. The owning user's
 * DB id is bound as GCM additional authenticated data — moving a ciphertext
 * to another user's row fails the auth tag.
 *
 * Rotation: encrypt always uses the active secret; decrypt falls back through
 * `KEY_VAULT_SECRET_PREVIOUS` entries so operators can rotate by re-encrypting
 * online. Losing every secret makes custodied keys unrecoverable — never
 * delete ciphertext on a decrypt failure.
 */

const MAGIC = Buffer.from('LWKV01', 'utf8') // 6 bytes
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const HKDF_INFO = 'lawallet-nsec-vault-v1'

const PRIVKEY_HEX = /^[0-9a-f]{64}$/

/** Thrown when no configured vault secret decrypts an envelope. */
export class VaultDecryptError extends Error {
  constructor(message = 'Key vault decryption failed') {
    super(message)
    this.name = 'VaultDecryptError'
  }
}

/** True when `KEY_VAULT_SECRET` is configured (passkey signup available). */
export function isVaultConfigured(): boolean {
  return getConfig().keyVault.enabled
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, salt, HKDF_INFO, KEY_LEN))
}

/** Encrypts a 64-char hex Nostr private key under the active vault secret. */
export function encryptNsec(privkeyHex: string, userId: string): Buffer {
  const { secret } = getConfig().keyVault
  if (!secret) {
    throw new Error('KEY_VAULT_SECRET is not configured')
  }
  if (!PRIVKEY_HEX.test(privkeyHex)) {
    throw new Error('encryptNsec expects a 64-char lowercase hex private key')
  }

  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = deriveKey(secret, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(userId, 'utf8'))
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(privkeyHex, 'hex')),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, salt, iv, tag, ciphertext])
}

function tryDecrypt(
  secret: string,
  salt: Buffer,
  iv: Buffer,
  tag: Buffer,
  ciphertext: Buffer,
  userId: string
): Buffer | null {
  try {
    const key = deriveKey(secret, salt)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(userId, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    return null
  }
}

/**
 * Reverses {@link encryptNsec}, returning the 64-char hex private key. Tries
 * the active secret first, then each `KEY_VAULT_SECRET_PREVIOUS` entry.
 *
 * @throws {VaultDecryptError} When the envelope is malformed or no configured
 *   secret authenticates it (wrong secret, tampering, or userId mismatch).
 */
export function decryptNsec(envelope: Uint8Array, userId: string): string {
  const { secret, previousSecrets } = getConfig().keyVault
  if (!secret) {
    throw new Error('KEY_VAULT_SECRET is not configured')
  }

  const buf = Buffer.from(envelope)
  const minLen = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + KEY_LEN
  if (buf.length < minLen || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new VaultDecryptError('Malformed key vault envelope')
  }

  let offset = MAGIC.length
  const salt = buf.subarray(offset, (offset += SALT_LEN))
  const iv = buf.subarray(offset, (offset += IV_LEN))
  const tag = buf.subarray(offset, (offset += TAG_LEN))
  const ciphertext = buf.subarray(offset)

  for (const candidate of [secret, ...previousSecrets]) {
    const plain = tryDecrypt(candidate, salt, iv, tag, ciphertext, userId)
    if (plain) return plain.toString('hex')
  }

  throw new VaultDecryptError()
}

/**
 * Re-encrypts an envelope under the active secret (rotation helper). Accepts
 * envelopes readable via any configured previous secret.
 */
export function rotateEnvelope(envelope: Uint8Array, userId: string): Buffer {
  return encryptNsec(decryptNsec(envelope, userId), userId)
}
