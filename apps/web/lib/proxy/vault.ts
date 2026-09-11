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

/**
 * Active secret first, then each `NWC_VAULT_SECRET_PREVIOUS` entry, so a
 * rotation can be completed online instead of stranding every credential.
 */
function vaultSecretChain(): string[] {
  const { secret, previousSecrets } = getConfig().nwcVault
  if (!secret) throw new Error('NWC_VAULT_SECRET is not configured')
  return [secret, ...previousSecrets]
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

function tryDecryptLegacy(
  buf: Buffer,
  recordId: string,
  field: string,
  secret: string
): string | null {
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
    return null
  }
}

function decryptWith(
  buf: Buffer,
  recordId: string,
  field: string,
  secrets: string[]
): string {
  const asText = buf.toString('utf8')
  if (isNwcVaultEnvelope(asText)) {
    try {
      return decryptNwcVaultEnvelope(asText, recordId, field, secrets)
    } catch {
      throw new ProxyVaultDecryptError()
    }
  }
  if (isLegacyProxyEnvelope(buf)) {
    for (const secret of secrets) {
      const plaintext = tryDecryptLegacy(buf, recordId, field, secret)
      if (plaintext !== null) return plaintext
    }
    throw new ProxyVaultDecryptError()
  }
  throw new ProxyVaultDecryptError('Malformed proxy vault envelope')
}

export function decryptProxySecret(
  envelope: Uint8Array,
  recordId: string,
  field: string
): string {
  return decryptWith(Buffer.from(envelope), recordId, field, vaultSecretChain())
}

/**
 * Whether the stored bytes are already what {@link encryptProxySecret} would
 * write today: the canonical envelope, sealed with the *active* secret. False
 * for a legacy envelope or one that only opens under a previous secret — both
 * are readable, and both get re-sealed at startup.
 */
export function isProxySecretCurrent(
  envelope: Uint8Array,
  recordId: string,
  field: string
): boolean {
  const { secret } = getConfig().nwcVault
  if (!secret) return false
  const buf = Buffer.from(envelope)
  if (!isCanonicalNwcVaultBytes(buf)) return false
  try {
    decryptWith(buf, recordId, field, [secret])
    return true
  } catch {
    return false
  }
}
