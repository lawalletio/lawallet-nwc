import { createDecipheriv, hkdfSync } from 'node:crypto'
import type { ListenerEnv } from './env'
import {
  decryptNwcVaultEnvelope,
  NWC_VAULT_ENVELOPE_PREFIX
} from './remote-wallet-vault'

const LEGACY_MAGIC = Buffer.from('LWPX01', 'utf8')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const LEGACY_HKDF_INFO = 'lawallet-proxy-vault-v1'

function deriveLegacyKey(secret: string, salt: Buffer): Buffer {
  return Buffer.from(
    hkdfSync('sha256', secret, salt, LEGACY_HKDF_INFO, KEY_LEN)
  )
}

function decryptLegacyProxyNwcUri(
  buf: Buffer,
  recordId: string,
  env: ListenerEnv
): string {
  const minimum = LEGACY_MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1
  if (
    buf.length < minimum ||
    !buf.subarray(0, LEGACY_MAGIC.length).equals(LEGACY_MAGIC)
  ) {
    throw new Error('Malformed proxy NWC vault envelope')
  }

  let offset = LEGACY_MAGIC.length
  const salt = buf.subarray(offset, (offset += SALT_LEN))
  const iv = buf.subarray(offset, (offset += IV_LEN))
  const tag = buf.subarray(offset, (offset += TAG_LEN))
  const ciphertext = buf.subarray(offset)
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveLegacyKey(env.NWC_VAULT_SECRET, salt),
      iv
    )
    decipher.setAAD(Buffer.from(`${recordId}:nwc`, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]).toString('utf8')
  } catch {
    throw new Error('Proxy NWC vault decryption failed')
  }
}

export function decryptProxyNwcUri(
  envelope: Uint8Array,
  recordId: string,
  env: ListenerEnv
): string {
  if (!env.NWC_VAULT_SECRET) {
    throw new Error('NWC_VAULT_SECRET is not configured')
  }
  const buf = Buffer.from(envelope)
  const asText = buf.toString('utf8')
  if (asText.startsWith(NWC_VAULT_ENVELOPE_PREFIX)) {
    try {
      return decryptNwcVaultEnvelope(asText, recordId, 'nwc', env)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'NWC_VAULT_SECRET is not configured'
      ) {
        throw error
      }
      throw new Error('Proxy NWC vault decryption failed')
    }
  }
  return decryptLegacyProxyNwcUri(buf, recordId, env)
}
