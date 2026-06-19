/**
 * Browser-side helpers for the card emulator.
 *
 * SUN signing now happens **server-side** (`POST /api/cards/[id]/emulate-tap`)
 * so a card's `k1`/`k2` keys never reach the browser. This module is left with
 * only the non-sensitive URL/UID helpers the emulator UI still needs.
 */

export interface TapPC {
  /** Encrypted PICC data — 32 uppercase hex chars. */
  p: string
  /** SDMMAC — 16 uppercase hex chars. */
  c: string
}

export function bytesToHexUpper(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/** Build the BoltCard scan URL a tap would resolve to. */
export function buildScanUrl(
  baseUrl: string,
  cardId: string,
  pc: TapPC
): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/cards/${cardId}/scan?p=${pc.p}&c=${pc.c}`
}

/** Generate a random 7-byte NTAG424-style UID as uppercase hex (NXP prefix 0x04). */
export function randomUid(): string {
  const uid = new Uint8Array(7)
  globalThis.crypto.getRandomValues(uid)
  uid[0] = 0x04
  return bytesToHexUpper(uid)
}
