import { describe, it, expect } from 'vitest'
import {
  buildScanUrl,
  bytesToHexUpper,
  randomUid
} from '@/lib/client/card-emulator-crypto'

// SUN signing moved server-side (see ntag424-sign.test.ts). These cover the
// remaining non-sensitive browser helpers the emulator UI uses.

describe('card-emulator-crypto helpers', () => {
  it('builds a scan URL with the encoded params', () => {
    const url = buildScanUrl('https://host.example/', 'card123', {
      p: 'AA'.repeat(16),
      c: 'BB'.repeat(8)
    })
    expect(url).toBe(
      `https://host.example/api/cards/card123/scan?p=${'AA'.repeat(16)}&c=${'BB'.repeat(8)}`
    )
  })

  it('generates a 7-byte UID with the NXP 0x04 prefix', () => {
    const uid = randomUid()
    expect(uid).toMatch(/^04[A-F0-9]{12}$/)
    expect(bytesToHexUpper(new Uint8Array([0x04, 0xab]))).toBe('04AB')
  })
})
