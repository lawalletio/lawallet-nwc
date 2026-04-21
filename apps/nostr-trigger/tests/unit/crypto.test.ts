import { describe, it, expect, beforeEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptSecret, decryptSecret } from '../../src/security/crypto.js'

describe('security/crypto', () => {
  beforeEach(() => {
    process.env.NT_MASTER_KEY = randomBytes(32).toString('base64')
  })

  it('round-trips plaintext', () => {
    const plaintext = 'super-secret-value 🌯'
    const envelope = encryptSecret(plaintext)
    expect(envelope).not.toContain(plaintext)
    expect(decryptSecret(envelope)).toBe(plaintext)
  })

  it('produces different ciphertext on each call (random IV)', () => {
    const a = encryptSecret('x')
    const b = encryptSecret('x')
    expect(a).not.toBe(b)
  })

  it('throws on tampered envelope', () => {
    const envelope = encryptSecret('hello')
    const [iv, ct, tag] = envelope.split(':')
    const tamperedCt = Buffer.from(ct, 'base64')
    tamperedCt[0] ^= 0xff
    const tampered = [iv, tamperedCt.toString('base64'), tag].join(':')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('throws on malformed envelope', () => {
    expect(() => decryptSecret('not:valid')).toThrow(/envelope/i)
  })
})
