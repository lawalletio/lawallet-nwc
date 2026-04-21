import { describe, it, expect } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex } from 'nostr-tools/utils'
import { decryptWithFallback, encryptNip44 } from '../../src/nostr/encryption.js'

describe('nostr/encryption', () => {
  it('round-trips a NIP-44 message between two keypairs', () => {
    const alice = generateSecretKey()
    const bob = generateSecretKey()
    const aliceSkHex = bytesToHex(alice)
    const bobSkHex = bytesToHex(bob)
    const bobPk = getPublicKey(bob)
    const alicePk = getPublicKey(alice)

    const plaintext = 'hello from alice'
    const ciphertext = encryptNip44(aliceSkHex, bobPk, plaintext)

    const decrypted = decryptWithFallback(bobSkHex, alicePk, ciphertext)
    expect(decrypted).toBe(plaintext)
  })

  it('throws when neither NIP-44 nor NIP-04 decrypts', () => {
    const alice = generateSecretKey()
    const alicePk = getPublicKey(alice)
    expect(() =>
      decryptWithFallback(bytesToHex(alice), alicePk, 'not-valid-ciphertext')
    ).toThrow(/Decryption failed/)
  })
})
