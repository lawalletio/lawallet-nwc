import { Ntag424WriteData, Ntag424WipeData, Ntag424 } from '@/types/ntag424'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { AesCmac } from 'aes-cmac'

const debug = (message: string) => {
  console.info(message)
}

/**
 * Builds the Boltcard "write" payload used to provision a blank NTAG424 with
 * this card's keys and the LNURLW base pointing at our scan endpoint.
 *
 * Takes the raw `ntag424` (keys) directly rather than a `Card`, since the public
 * `Card` type no longer carries keys.
 *
 * @param ntag424 - The card's NTAG424 record (with keys).
 * @param cardId - The card id, for the `lnurlw://` scan URL.
 * @param cardTitle - Optional card title for `card_name`.
 * @param domain - The platform's public host (used in the `lnurlw://` URL).
 */
export function cardToNtag424WriteData(
  ntag424: Ntag424,
  cardId: string,
  cardTitle: string | null | undefined,
  domain: string
): Ntag424WriteData {
  return {
    card_name: cardTitle || 'Unnamed',
    id: ntag424.cid,
    k0: ntag424.k0,
    k1: ntag424.k1,
    k2: ntag424.k2,
    k3: ntag424.k3,
    k4: ntag424.k4,
    lnurlw_base: `lnurlw://${domain}/api/cards/${cardId}/scan`,
    protocol_name: 'new_bolt_card_response',
    protocol_version: '1'
  }
}

/**
 * Builds the Boltcard "wipe" payload that resets an NTAG424 back to factory
 * defaults using the card's recorded keys.
 */
export function cardToNtag424WipeData(ntag424: Ntag424): Ntag424WipeData {
  return {
    action: 'wipe',
    k0: ntag424.k0,
    k1: ntag424.k1,
    k2: ntag424.k2,
    k3: ntag424.k3,
    k4: ntag424.k4,
    uid: ntag424.cid,
    version: 1
  }
}

/**
 * Generates a fresh set of NTAG424 keys (k0–k4, 16 bytes each) and a zeroed
 * tap counter for a given card UID. Keys are 128-bit AES keys returned as
 * lowercase hex.
 */
export function generateNtag424Values(cid: string) {
  return {
    cid,
    k0: randomBytes(16).toString('hex'),
    k1: randomBytes(16).toString('hex'),
    k2: randomBytes(16).toString('hex'),
    k3: randomBytes(16).toString('hex'),
    k4: randomBytes(16).toString('hex'),
    ctr: 0
  }
}

/// *********** Ntag424 tap verification ***********

/**
 * Reasons a tap can be rejected during {@link consumeNtag424FromPC}. Surfaced
 * to the caller via the `error` branch of the result; never thrown.
 */
export enum Ntag424Error {
  MALFORMED_P__NOT_A_32_CHAR_UPPERCASE_HEX_VALUE = 'Malformed p: not a 32-char uppercase hex value',
  MALFORMED_P__DOES_NOT_START_WITH_0XC7 = 'Malformed p: does not start with 0xC7',
  MALFORMED_P__COUNTER_VALUE_TOO_OLD = 'Malformed p: counter value too old',
  //
  MALFORMED_C__NOT_A_16_CHAR_UPPERCASE_HEX_VALUE = 'Malformed c: not a 16-char uppercase hex value',
  MALFORMED_C__SDMMAC_MISMATCH = 'Malformed c: SDMMAC mismatch',
  //
  NO_SUITABLE_CARD_FOUND = 'No suitable card found'
}

const zeroIv: Buffer = Buffer.alloc(16)
const sv2prefix: Buffer = Buffer.from('3cc300010080', 'hex')

/**
 * Decrypt (using the the given hex-string key) the given hex-string ciphertext, and return the decrypted result as a lowercase hex-string
 *
 * @param ciphertext  The ciphertext to decrypt with the server-side keys, as a hex-string
 * @returns  The decrypted result, as a lowercase hex-string
 */
const decrypt = (key: string, ciphertext: string): Buffer => {
  return createDecipheriv('aes128', Buffer.from(key, 'hex'), zeroIv)
    .setAutoPadding(false)
    .update(Buffer.from(ciphertext, 'hex'))
}

/**
 * Calculate the SDMMAC signature for the given card ID and tap-counter value, using the given key
 *
 * @param k2  Key to use (viz. k2), to calculate the SDMMAC
 * @param cid  Card ID, as a byte-buffer
 * @param ctr  Card tap-counter, as a byte value
 * @returns   The calculated SDMMAC value, as a lowercase hex-string
 */
const sdmmac = async (
  k2: string,
  cid: Buffer,
  ctr: Buffer
): Promise<string> => {
  const cmacBytes: Uint8Array = await new AesCmac(
    await new AesCmac(Buffer.from(k2, 'hex')).calculate(
      Buffer.from([...sv2prefix, ...cid, ...ctr])
    )
  ).calculate(Buffer.alloc(0))
  return Buffer.from([
    cmacBytes[1],
    cmacBytes[3],
    cmacBytes[5],
    cmacBytes[7],
    cmacBytes[9],
    cmacBytes[11],
    cmacBytes[13],
    cmacBytes[15]
  ])
    .toString('hex')
    .toLowerCase()
}

/**
 * Given the "p" and "c" arguments in the scan url, retrieve the associated Ntag424 entity and update the card tap-counter
 *
 * @param p  The scan url's "p" parameter (ie.    AES(k1     , ctr || cid))
 * @param c  The scan url's "c" parameter (ie. SDMMAC(k2[cid], ctr || cid))
 * @returns  The retrieved Ntag424 entity or null if errors encountered
 */
export const consumeNtag424FromPC = async (
  ntag424: Ntag424,
  p: string | undefined,
  c: string | undefined
): Promise<
  { ok: Ntag424; ctrOld: number; ctrNew: number } | { error: Ntag424Error }
> => {
  if (typeof p !== 'string' || !/^[A-F0-9]{32}$/.test(p)) {
    debug(Ntag424Error.MALFORMED_P__NOT_A_32_CHAR_UPPERCASE_HEX_VALUE)
    return {
      error: Ntag424Error.MALFORMED_P__NOT_A_32_CHAR_UPPERCASE_HEX_VALUE
    }
  }
  if (typeof c !== 'string' || !/^[A-F0-9]{16}$/.test(c)) {
    debug(Ntag424Error.MALFORMED_C__NOT_A_16_CHAR_UPPERCASE_HEX_VALUE)
    return {
      error: Ntag424Error.MALFORMED_C__NOT_A_16_CHAR_UPPERCASE_HEX_VALUE
    }
  }

  const pBytes: Buffer = decrypt(ntag424.k1, p)
  if (0xc7 !== pBytes[0]) {
    debug(Ntag424Error.MALFORMED_P__DOES_NOT_START_WITH_0XC7)
    return { error: Ntag424Error.MALFORMED_P__DOES_NOT_START_WITH_0XC7 }
  }

  const cidBytes: Buffer = pBytes.subarray(1, 8)
  const ctrBytes: Buffer = pBytes.subarray(8, 11)

  const cid: string = cidBytes.toString('hex').toLowerCase()
  const ctrNew: number = (ctrBytes[2] << 16) | (ctrBytes[1] << 8) | ctrBytes[0] // LSB

  if (ntag424.cid.toUpperCase() !== cid.toUpperCase()) {
    debug(Ntag424Error.NO_SUITABLE_CARD_FOUND)
    return { error: Ntag424Error.NO_SUITABLE_CARD_FOUND }
  }
  const ctrOld: number = ntag424.ctr
  const k2: string = ntag424.k2

  if (ctrNew <= ctrOld) {
    debug(Ntag424Error.MALFORMED_P__COUNTER_VALUE_TOO_OLD)
    return { error: Ntag424Error.MALFORMED_P__COUNTER_VALUE_TOO_OLD }
  }

  if (c.toLowerCase() !== (await sdmmac(k2, cidBytes, ctrBytes))) {
    debug(Ntag424Error.MALFORMED_C__SDMMAC_MISMATCH)
    return { error: Ntag424Error.MALFORMED_C__SDMMAC_MISMATCH }
  }

  return { ok: ntag424, ctrOld, ctrNew }
}

/**
 * Signs a simulated SUN tap for `ctr` — the inverse of
 * {@link consumeNtag424FromPC}. Used by the admin card emulator's server-side
 * signing endpoint so the card's `k1`/`k2` never leave the server; only the
 * public `p`/`c` URL params are returned.
 *
 * - `p` = AES-128-CBC encrypt (zero IV, no padding) under `k1` of the 16-byte
 *   block `0xC7 ‖ cid(7) ‖ ctr(3, little-endian) ‖ 00×5`.
 * - `c` = the SDMMAC over the same `cid`/`ctr` under `k2` (reuses {@link sdmmac}).
 *
 * Returns uppercase hex (`p` 32 chars, `c` 16 chars) matching the format
 * `consumeNtag424FromPC` validates.
 */
export const signNtag424Tap = async (
  ntag424: Pick<Ntag424, 'cid' | 'k1' | 'k2'>,
  ctr: number
): Promise<{ p: string; c: string }> => {
  const cidBytes: Buffer = Buffer.from(ntag424.cid, 'hex')
  const ctrBytes: Buffer = Buffer.from([
    ctr & 0xff,
    (ctr >> 8) & 0xff,
    (ctr >> 16) & 0xff
  ])
  const block: Buffer = Buffer.concat([
    Buffer.from([0xc7]),
    cidBytes,
    ctrBytes,
    Buffer.alloc(5)
  ])
  const cipher = createCipheriv(
    'aes128',
    Buffer.from(ntag424.k1, 'hex'),
    zeroIv
  ).setAutoPadding(false)
  const p: Buffer = Buffer.concat([cipher.update(block), cipher.final()])
  const c: string = await sdmmac(ntag424.k2, cidBytes, ctrBytes)
  return {
    p: p.toString('hex').toUpperCase(),
    c: c.toUpperCase()
  }
}
