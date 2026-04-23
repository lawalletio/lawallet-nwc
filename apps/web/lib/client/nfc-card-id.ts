/**
 * Helpers for validating and normalising NFC card UIDs entered in the
 * Create Card dialog. The UI accepts both `04:AB:CD:EF:12:34:56` and the
 * collapsed `04ABCDEF123456` forms so users can paste whatever their
 * encoder printed; internally we always store the colon-separated,
 * uppercase canonical form.
 *
 * Cards we care about (ISO 14443 Type 2 / NTAG424) have either a 7-byte
 * (14 hex chars) or 4-byte (8 hex chars) UID — accept both lengths.
 */

const VALID_BYTE_LENGTHS = [4, 7] as const

/** Strip colons/whitespace and return the hex payload in upper-case. */
export function stripCardId(input: string): string {
  return input.replace(/[\s:]+/g, '').toUpperCase()
}

export function isValidCardId(input: string): boolean {
  const hex = stripCardId(input)
  if (!/^[0-9A-F]+$/.test(hex)) return false
  if (hex.length % 2 !== 0) return false
  const bytes = hex.length / 2
  return (VALID_BYTE_LENGTHS as readonly number[]).includes(bytes)
}

/**
 * Return the canonical `AA:BB:CC:...` form (upper-case, colon-separated
 * byte pairs) or `null` if the input isn't a recognisable card UID.
 */
export function formatCardId(input: string): string | null {
  if (!isValidCardId(input)) return null
  const hex = stripCardId(input)
  return hex.match(/.{2}/g)!.join(':')
}
