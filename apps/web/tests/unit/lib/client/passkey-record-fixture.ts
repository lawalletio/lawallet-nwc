// Independent fixture encoder for testing malformed authenticated records.
import { hexToBytes } from '@nostr-wot/identity/vault'
import type { StoredRecordContext, StoredType } from '@/lib/passkey-store'
const HEADER = [0x4e, 0x50, 0x4b, 0x01]
const HEADER_BYTES = 49
const STORED_PRF_LABEL = 'nostr-passkey:store:v1'
const STORED_TYPES = { key: 1, seed: 2, vault: 3 }
const STORED_MAX_PLAINTEXT = 65536
class StoredKeyError extends Error {
  constructor(_code: string, message: string) {
    super(message)
  }
}
function buffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength
  ) as ArrayBuffer
}

export function storedRecordAad(
  type: StoredType,
  context: StoredRecordContext
): Uint8Array<ArrayBuffer> {
  const rp = new TextEncoder().encode(context.rpId)
  const id = context.credentialId
  if (
    !rp.length ||
    rp.length > 255 ||
    !/^[0-9a-f]{64}$/.test(context.author) ||
    !id.length ||
    id.length > 0xffff
  ) {
    throw new StoredKeyError('invalid-record', 'Invalid stored record context')
  }
  const aad = new Uint8Array(5 + 1 + rp.length + 32 + 2 + id.length)
  let at = 0
  aad.set(HEADER, at)
  at += 4
  aad[at++] = STORED_TYPES[type]
  aad[at++] = rp.length
  aad.set(rp, at)
  at += rp.length
  aad.set(hexToBytes(context.author), at)
  at += 32
  aad[at++] = id.length >> 8
  aad[at++] = id.length & 0xff
  aad.set(id, at)
  return aad
}

async function recordKey(
  prf: Uint8Array,
  salt: Uint8Array,
  usage: KeyUsage
): Promise<CryptoKey> {
  if (prf.length !== 32) {
    throw new StoredKeyError('invalid-record', 'PRF output must be 32 bytes')
  }
  const ikm = await crypto.subtle.importKey('raw', buffer(prf), 'HKDF', false, [
    'deriveBits'
  ])
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: buffer(salt),
        info: buffer(new TextEncoder().encode(STORED_PRF_LABEL))
      },
      ikm,
      256
    )
  )
  try {
    return await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, [usage])
  } finally {
    bits.fill(0)
  }
}

/**
 * Encrypts `plaintext` into a record. `salt` and `iv` are fresh random
 * values unless given (only the vector test passes them; reusing an IV
 * breaks AES-GCM).
 */
export async function sealStoredRecord(
  plaintext: Uint8Array,
  prf: Uint8Array,
  type: StoredType,
  context: StoredRecordContext,
  nonces?: { salt: Uint8Array; iv: Uint8Array }
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    !plaintext.length ||
    plaintext.length > STORED_MAX_PLAINTEXT ||
    (type === 'key' && plaintext.length !== 32)
  ) {
    throw new StoredKeyError('invalid-payload', 'Invalid stored payload size')
  }
  const salt = nonces?.salt ?? crypto.getRandomValues(new Uint8Array(32))
  const iv = nonces?.iv ?? crypto.getRandomValues(new Uint8Array(12))
  const aad = storedRecordAad(type, context)
  const key = await recordKey(prf, salt, 'encrypt')
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buffer(iv), additionalData: aad },
      key,
      buffer(plaintext)
    )
  )
  const record = new Uint8Array(HEADER_BYTES + ciphertext.length)
  record.set(HEADER)
  record[4] = STORED_TYPES[type]
  record.set(iv, 5)
  record.set(salt, 17)
  record.set(ciphertext, HEADER_BYTES)
  return record
}
