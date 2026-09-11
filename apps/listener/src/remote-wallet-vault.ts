import { createDecipheriv, hkdfSync } from 'node:crypto'
import type { ListenerEnv } from './env'

export const NWC_VAULT_ENVELOPE_PREFIX = 'lwrw1:'
const MAGIC = Buffer.from('LWRW01', 'utf8')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const HKDF_INFO = 'lawallet-remote-wallet-nwc-v1'

function deriveKey(secret: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, salt, HKDF_INFO, KEY_LEN))
}

/**
 * Active secret first, then each `NWC_VAULT_SECRET_PREVIOUS` entry. Web
 * re-seals everything under the active secret at startup, but the listener
 * can boot first, so it has to accept the same chain.
 */
export function vaultSecretChain(env?: ListenerEnv): string[] {
  if (!env?.NWC_VAULT_SECRET) return []
  const previous = (env.NWC_VAULT_SECRET_PREVIOUS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return [env.NWC_VAULT_SECRET, ...previous]
}

export function decryptNwcVaultEnvelope(
  stored: string,
  recordId: string,
  field: string,
  env?: ListenerEnv
): string {
  if (!stored.startsWith(NWC_VAULT_ENVELOPE_PREFIX)) {
    // Rolling-deploy compatibility while web performs the mandatory startup
    // backfill. Newly persisted rows are always encrypted.
    return stored
  }
  const secrets = vaultSecretChain(env)
  if (secrets.length === 0) {
    throw new Error('NWC_VAULT_SECRET is not configured')
  }

  const buf = Buffer.from(
    stored.slice(NWC_VAULT_ENVELOPE_PREFIX.length),
    'base64url'
  )
  const minimum = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1
  if (buf.length < minimum || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Malformed NWC vault envelope')
  }

  let offset = MAGIC.length
  const salt = buf.subarray(offset, (offset += SALT_LEN))
  const iv = buf.subarray(offset, (offset += IV_LEN))
  const tag = buf.subarray(offset, (offset += TAG_LEN))
  const ciphertext = buf.subarray(offset)

  for (const secret of secrets) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveKey(secret, salt),
        iv
      )
      decipher.setAAD(Buffer.from(`${recordId}:${field}`, 'utf8'))
      decipher.setAuthTag(tag)
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]).toString('utf8')
    } catch {
      // Try the next rotation key.
    }
  }
  throw new Error('NWC vault decryption failed')
}

export function decryptRemoteWalletNwcUri(
  stored: string,
  walletId: string,
  env?: ListenerEnv
): string {
  try {
    return decryptNwcVaultEnvelope(stored, walletId, 'connection-string', env)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'NWC vault decryption failed'
    ) {
      throw new Error('Remote wallet NWC vault decryption failed')
    }
    if (
      error instanceof Error &&
      error.message === 'Malformed NWC vault envelope'
    ) {
      throw new Error('Malformed remote wallet NWC vault envelope')
    }
    throw error
  }
}
