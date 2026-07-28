import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes
} from 'node:crypto'
import { getConfig } from '@/lib/config'

const MAGIC = Buffer.from('LWPX01', 'utf8')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const HKDF_INFO = 'lawallet-proxy-vault-v1'

export class ProxyVaultDecryptError extends Error {
  constructor(message = 'Proxy vault decryption failed') {
    super(message)
    this.name = 'ProxyVaultDecryptError'
  }
}

export function isProxyVaultConfigured(): boolean {
  return getConfig(false).nwcVault.enabled
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, salt, HKDF_INFO, KEY_LEN))
}

function aad(recordId: string, field: string): Buffer {
  return Buffer.from(`${recordId}:${field}`, 'utf8')
}

export function encryptProxySecret(
  plaintext: string,
  recordId: string,
  field: string
): Uint8Array<ArrayBuffer> {
  const { secret } = getConfig().nwcVault
  if (!secret) throw new Error('NWC_VAULT_SECRET is not configured')
  if (!plaintext) throw new Error('Proxy secret cannot be empty')

  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret, salt), iv)
  cipher.setAAD(aad(recordId, field))
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final()
  ])
  return Uint8Array.from(
    Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext])
  )
}

export function decryptProxySecret(
  envelope: Uint8Array,
  recordId: string,
  field: string
): string {
  const { secret } = getConfig().nwcVault
  if (!secret) throw new Error('NWC_VAULT_SECRET is not configured')

  const buf = Buffer.from(envelope)
  const minimum = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1
  if (buf.length < minimum || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new ProxyVaultDecryptError('Malformed proxy vault envelope')
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
    throw new ProxyVaultDecryptError()
  }
}
