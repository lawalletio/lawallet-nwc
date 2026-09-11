import { createDecipheriv, hkdfSync } from 'node:crypto'
import { getConfig } from '@/lib/config'
import {
  decryptNwcVaultEnvelope,
  encryptNwcVaultEnvelope,
  isNwcVaultEnvelope
} from '@/lib/wallet/remote-wallet-vault-core'

const LEGACY_MAGIC = Buffer.from('LWPX01', 'utf8')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const LEGACY_HKDF_INFO = 'lawallet-proxy-vault-v1'

export class ProxyVaultDecryptError extends Error {
  constructor(message = 'Proxy vault decryption failed') {
    super(message)
    this.name = 'ProxyVaultDecryptError'
  }
}

export function isProxyVaultConfigured(): boolean {
  return Boolean(getConfig(false).nwcVault?.enabled)
}

function deriveLegacyKey(secret: string, salt: Buffer): Buffer {
  return Buffer.from(
    hkdfSync('sha256', secret, salt, LEGACY_HKDF_INFO, KEY_LEN)
  )
}

function isLegacyProxyEnvelope(buf: Buffer): boolean {
  const minimum = LEGACY_MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1
  return (
    buf.length >= minimum &&
    buf.subarray(0, LEGACY_MAGIC.length).equals(LEGACY_MAGIC)
  )
}

export function isCanonicalNwcVaultBytes(value: Uint8Array): boolean {
  return isNwcVaultEnvelope(Buffer.from(value).toString('utf8'))
}

export function encryptProxySecret(
  plaintext: string,
  recordId: string,
  field: string
): Uint8Array<ArrayBuffer> {
  const { secret } = getConfig().nwcVault
  if (!secret) throw new Error('NWC_VAULT_SECRET is not configured')
  if (!plaintext) throw new Error('Proxy secret cannot be empty')
  return Uint8Array.from(
    Buffer.from(
      encryptNwcVaultEnvelope(plaintext, recordId, field, secret),
      'utf8'
    )
  )
}

function decryptLegacyProxySecret(
  buf: Buffer,
  recordId: string,
  field: string,
  secret: string
): string {
  let offset = LEGACY_MAGIC.length
  const salt = buf.subarray(offset, (offset += SALT_LEN))
  const iv = buf.subarray(offset, (offset += IV_LEN))
  const tag = buf.subarray(offset, (offset += TAG_LEN))
  const ciphertext = buf.subarray(offset)
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveLegacyKey(secret, salt),
      iv
    )
    decipher.setAAD(Buffer.from(`${recordId}:${field}`, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw new ProxyVaultDecryptError()
  }
}

export function decryptProxySecret(
  envelope: Uint8Array,
  recordId: string,
  field: string
): string {
  const { secret } = getConfig().nwcVault
  if (!secret) throw new Error('NWC_VAULT_SECRET is not configured')

  const buf = Buffer.from(envelope)
  const asText = buf.toString('utf8')
  if (isNwcVaultEnvelope(asText)) {
    try {
      return decryptNwcVaultEnvelope(asText, recordId, field, [secret])
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'NWC_VAULT_SECRET is not configured'
      ) {
        throw error
      }
      throw new ProxyVaultDecryptError()
    }
  }
  if (isLegacyProxyEnvelope(buf)) {
    return decryptLegacyProxySecret(buf, recordId, field, secret)
  }
  throw new ProxyVaultDecryptError('Malformed proxy vault envelope')
}
