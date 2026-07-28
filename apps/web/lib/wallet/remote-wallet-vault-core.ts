import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes
} from 'node:crypto'

export const REMOTE_WALLET_ENVELOPE_PREFIX = 'lwrw1:'
const MAGIC = Buffer.from('LWRW01', 'utf8')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const HKDF_INFO = 'lawallet-remote-wallet-nwc-v1'
const FIELD = 'connection-string'

export class RemoteWalletVaultDecryptError extends Error {
  constructor(message = 'Remote wallet NWC vault decryption failed') {
    super(message)
    this.name = 'RemoteWalletVaultDecryptError'
  }
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, salt, HKDF_INFO, KEY_LEN))
}

function aad(walletId: string): Buffer {
  return Buffer.from(`${walletId}:${FIELD}`, 'utf8')
}

export function isRemoteWalletVaultEnvelope(value: unknown): value is string {
  return (
    typeof value === 'string' && value.startsWith(REMOTE_WALLET_ENVELOPE_PREFIX)
  )
}

export function encryptRemoteWalletEnvelope(
  plaintext: string,
  walletId: string,
  secret: string
): string {
  if (!plaintext)
    throw new Error('Remote wallet NWC connection cannot be empty')
  if (!secret) throw new Error('NWC_VAULT_SECRET is not configured')

  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv)
  cipher.setAAD(aad(walletId))
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
  return `${REMOTE_WALLET_ENVELOPE_PREFIX}${envelope.toString('base64url')}`
}

export function decryptRemoteWalletEnvelope(
  stored: string,
  walletId: string,
  secrets: string[]
): string {
  if (!isRemoteWalletVaultEnvelope(stored)) return stored
  if (secrets.length === 0) {
    throw new Error('NWC_VAULT_SECRET is not configured')
  }

  let buf: Buffer
  try {
    buf = Buffer.from(
      stored.slice(REMOTE_WALLET_ENVELOPE_PREFIX.length),
      'base64url'
    )
  } catch {
    throw new RemoteWalletVaultDecryptError('Malformed NWC vault envelope')
  }

  const minimum = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1
  if (buf.length < minimum || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new RemoteWalletVaultDecryptError('Malformed NWC vault envelope')
  }

  let offset = MAGIC.length
  const salt = buf.subarray(offset, (offset += SALT_LEN))
  const iv = buf.subarray(offset, (offset += IV_LEN))
  const tag = buf.subarray(offset, (offset += TAG_LEN))
  const ciphertext = buf.subarray(offset)

  for (const candidate of secrets) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveKey(candidate, salt),
        iv
      )
      decipher.setAAD(aad(walletId))
      decipher.setAuthTag(tag)
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]).toString('utf8')
    } catch {
      // Try the next rotation key.
    }
  }
  throw new RemoteWalletVaultDecryptError()
}
