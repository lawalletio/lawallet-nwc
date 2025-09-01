import { Card } from '@/types'
import { Ntag424WriteData, Ntag424WipeData, Ntag424 } from '@/types/ntag424'
import { createDecipheriv, randomBytes } from 'crypto'
import { AesCmac } from 'aes-cmac'

const debug = (message: string) => {
  console.info(message)
}

export function cardToNtag424WriteData(
  card: Card,
  domain: string
): Ntag424WriteData {
  return {
    card_name: card.title || 'Unnamed',
    id: card.ntag424!.cid,
    k0: card.ntag424!.k0,
    k1: card.ntag424!.k1,
    k2: card.ntag424!.k2,
    k3: card.ntag424!.k3,
    k4: card.ntag424!.k4,
    lnurlw_base: `lnurlw://${domain}/api/cards/${card.id}/scan`,
    protocol_name: 'new_bolt_card_response',
    protocol_version: '1'
  }
}

export function cardToNtag424WipeData(card: Card): Ntag424WipeData {
  return {
    action: 'wipe',
    k0: card.ntag424!.k0,
    k1: card.ntag424!.k1,
    k2: card.ntag424!.k2,
    k3: card.ntag424!.k3,
    k4: card.ntag424!.k4,
    uid: card.ntag424!.cid,
    version: 1
  }
}

// Function to generate random ntag424 values
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
