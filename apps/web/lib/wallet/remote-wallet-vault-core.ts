import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes
} from 'node:crypto'

export const NWC_VAULT_ENVELOPE_PREFIX = 'lwrw1:'
/** @deprecated Use {@link NWC_VAULT_ENVELOPE_PREFIX}. */
export const REMOTE_WALLET_ENVELOPE_PREFIX = NWC_VAULT_ENVELOPE_PREFIX
export const NWC_CONNECTION_STRING_FIELD = 'connection-string'

const MAGIC = Buffer.from('LWRW01', 'utf8')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const HKDF_INFO = 'lawallet-remote-wallet-nwc-v1'

export class RemoteWalletVaultDecryptError extends Error {
  constructor(message = 'Remote wallet NWC vault decryption failed') {
    super(message)
    this.name = 'RemoteWalletVaultDecryptError'
  }
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, salt, HKDF_INFO, KEY_LEN))
}

function aad(recordId: string, field: string): Buffer {
  return Buffer.from(`${recordId}:${field}`, 'utf8')
}

export function isNwcVaultEnvelope(value: unknown): value is string {
  return (
    typeof value === 'string' && value.startsWith(NWC_VAULT_ENVELOPE_PREFIX)
  )
}

export function isRemoteWalletVaultEnvelope(value: unknown): value is string {
  return isNwcVaultEnvelope(value)
}

export function encryptNwcVaultEnvelope(
  plaintext: string,
  recordId: string,
  field: string,
  secret: string
): string {
  if (!plaintext) throw new Error('NWC vault plaintext cannot be empty')
  if (!secret) throw new Error('NWC_VAULT_SECRET is not configured')

  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv)
  cipher.setAAD(aad(recordId, field))
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final()
  ])
  const envelope = Buffer.concat([
    MAGIC,
    salt,
    iv,
    cipher.getAuthTag(),
    ciphertext
  ])
  return `${NWC_VAULT_ENVELOPE_PREFIX}${envelope.toString('base64url')}`
}

export function decryptNwcVaultEnvelope(
  stored: string,
  recordId: string,
  field: string,
  secret: string | undefined
): string {
  if (!isNwcVaultEnvelope(stored)) return stored
  if (!secret) throw new Error('NWC_VAULT_SECRET is not configured')

  const buf = Buffer.from(
    stored.slice(NWC_VAULT_ENVELOPE_PREFIX.length),
    'base64url'
  )
  const minimum = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1
  if (buf.length < minimum || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new RemoteWalletVaultDecryptError('Malformed NWC vault envelope')
  }

  let offset = MAGIC.length
  const salt = buf.subarray(offset, (offset += SALT_LEN))
  const iv = buf.subarray(offset, (offset += IV_LEN))
  const tag = buf.subarray(offset, (offset += TAG_LEN))
  const ciphertext = buf.subarray(offset)

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(secret, salt),
      iv
    )
    decipher.setAAD(aad(recordId, field))
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw new RemoteWalletVaultDecryptError()
  }
}

export function encryptRemoteWalletEnvelope(
  plaintext: string,
  walletId: string,
  secret: string
): string {
  if (!plaintext) {
    throw new Error('Remote wallet NWC connection cannot be empty')
  }
  return encryptNwcVaultEnvelope(
    plaintext,
    walletId,
    NWC_CONNECTION_STRING_FIELD,
    secret
  )
}

export function decryptRemoteWalletEnvelope(
  stored: string,
  walletId: string,
  secret: string | undefined
): string {
  return decryptNwcVaultEnvelope(
    stored,
    walletId,
    NWC_CONNECTION_STRING_FIELD,
    secret
  )
}
