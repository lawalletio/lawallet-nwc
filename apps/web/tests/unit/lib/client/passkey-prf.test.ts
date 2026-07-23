import { describe, it, expect } from 'vitest'
import {
  PRF_SALT_HEX,
  prfSaltBytes,
  derivePrfNsecHex,
} from '@/lib/client/passkey-prf'
import { getPublicKeyFromPrivate } from '@/lib/nostr'

describe('passkey PRF derivation', () => {
  it('pins the consensus-critical salt (sha256 of lawallet-nsec-prf-v1)', async () => {
    expect(PRF_SALT_HEX).toBe(
      '8ee22949c1045c627e14236f1d06cf730b46b4cf309cbf4ede25a446cf33ad8d'
    )
    // Recompute to prove the constant matches its documented derivation.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('lawallet-nsec-prf-v1')
    )
    const hex = Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    expect(hex).toBe(PRF_SALT_HEX)
    expect(prfSaltBytes()).toHaveLength(32)
  })

  it('derives deterministically — fixed vector frozen forever', async () => {
    // ⚠️ FROZEN VECTOR: if this assertion ever fails, the derivation changed
    // and every existing passkey-derived identity would be orphaned. Revert
    // the change to passkey-prf.ts instead of updating this vector.
    const prfOutput = new Uint8Array(32).fill(7)
    const first = await derivePrfNsecHex(prfOutput)
    const second = await derivePrfNsecHex(prfOutput)
    expect(first).toBe(second)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(first).toBe(
      'a1e1ac8dd866cabdf743a4cdedbf53c680444094a25c0ffc4e558ec5a78831c1'
    )
  })

  it('different PRF outputs derive different keys', async () => {
    const a = await derivePrfNsecHex(new Uint8Array(32).fill(1))
    const b = await derivePrfNsecHex(new Uint8Array(32).fill(2))
    expect(a).not.toBe(b)
  })

  it('derived keys are valid secp256k1 scalars (pubkey derivable)', async () => {
    for (const fill of [1, 7, 200, 255]) {
      const hex = await derivePrfNsecHex(new Uint8Array(32).fill(fill))
      expect(getPublicKeyFromPrivate(hex)).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
