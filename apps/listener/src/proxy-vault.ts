import { createDecipheriv, hkdfSync } from 'node:crypto'
import type { ListenerEnv } from './env'

const MAGIC = Buffer.from('LWPX01', 'utf8')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const KEY_LEN = 32
const HKDF_INFO = 'lawallet-proxy-vault-v1'

function deriveKey(secret: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, salt, HKDF_INFO, KEY_LEN))
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
  const minimum = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN + 1
  if (buf.length < minimum || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Malformed proxy NWC vault envelope')
  }

  let offset = MAGIC.length
  const salt = buf.subarray(offset, (offset += SALT_LEN))
  const iv = buf.subarray(offset, (offset += IV_LEN))
  const tag = buf.subarray(offset, (offset += TAG_LEN))
  const ciphertext = buf.subarray(offset)
  const previous = (env.NWC_VAULT_SECRET_PREVIOUS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

  for (const secret of [env.NWC_VAULT_SECRET, ...previous]) {
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        deriveKey(secret, salt),
        iv
      )
      decipher.setAAD(Buffer.from(`${recordId}:nwc`, 'utf8'))
      decipher.setAuthTag(tag)
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final()
      ]).toString('utf8')
    } catch {
      // Try the next rotation key.
    }
  }
  throw new Error('Proxy NWC vault decryption failed')
}
