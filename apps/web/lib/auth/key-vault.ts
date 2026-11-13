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
 * Master secret: `KEY_VAULT_SECRET`, or — when that is unset — `JWT_SECRET`
 * under its own HKDF info (domain-separated from JWT signing). New envelopes
 * use the first available; decryption tries both, so adding
 * `KEY_VAULT_SECRET` later never strands existing keys. Losing (or, without
 * `KEY_VAULT_SECRET`, rotating `JWT_SECRET`) makes custodied keys
 * unrecoverable — never delete ciphertext on a decrypt failure.
 *
 * Not `NWC_VAULT_SECRET`: the listener holds that one and must never be able
 * to open custodied user keys.
 */

const MAGIC = Buffer.from('LWKV01', 'utf8') // 6 bytes
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const HKDF_INFO = 'lawallet-nsec-vault-v1'
const HKDF_INFO_JWT_FALLBACK = 'lawallet-nsec-vault-v1:jwt-secret'

const PRIVKEY_HEX = /^[0-9a-f]{64}$/

/** Thrown when the vault secret does not decrypt an envelope. */
export class VaultDecryptError extends Error {
  constructor(message = 'Key vault decryption failed') {
    super(message)
    this.name = 'VaultDecryptError'
  }
}

interface VaultSecret {
  secret: string
  info: string
}

/** Usable master secrets, preferred first. */
function vaultSecrets(): VaultSecret[] {
  // Optional chaining: config mocks in route tests are partial.
  const config = getConfig()
  const out: VaultSecret[] = []
  if (config?.keyVault?.secret) {
    out.push({ secret: config.keyVault.secret, info: HKDF_INFO })
  }
  if (config?.jwt?.secret) {
    out.push({ secret: config.jwt.secret, info: HKDF_INFO_JWT_FALLBACK })
  }
  return out
}

/** True when a vault secret is available (KEY_VAULT_SECRET or JWT_SECRET). */
export function isVaultConfigured(): boolean {
  return vaultSecrets().length > 0
}

function deriveKey({ secret, info }: VaultSecret, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, salt, info, KEY_LEN))
}

/** Encrypts a 64-char hex Nostr private key under the active vault secret. */
export function encryptNsec(privkeyHex: string, userId: string): Buffer {
  const [secret] = vaultSecrets()
  if (!secret) {
    throw new Error('KEY_VAULT_SECRET (or JWT_SECRET) is not configured')
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

/**
 * Reverses {@link encryptNsec}, returning the 64-char hex private key.
 *
 * @throws {VaultDecryptError} When the envelope is malformed or the secret
 *   does not authenticate it (wrong secret, tampering, or userId mismatch).
 */
export function decryptNsec(envelope: Uint8Array, userId: string): string {
  const secrets = vaultSecrets()
  if (secrets.length === 0) {
    throw new Error('KEY_VAULT_SECRET (or JWT_SECRET) is not configured')
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

  // GCM authenticates, so a wrong secret fails cleanly — try each in turn.
  for (const secret of secrets) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveKey(secret, salt),
        iv
      )
      decipher.setAAD(Buffer.from(userId, 'utf8'))
      decipher.setAuthTag(tag)
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]).toString('hex')
    } catch {
      // next secret
    }
  }
  throw new VaultDecryptError()
}
