import { describe, it, expect } from 'vitest'
import { zipSync } from 'fflate'
import {
  encryptArchive,
  decryptArchive,
  isEncryptedArchive,
} from '@/lib/backup/crypto'

const PASSWORD = 'correct horse battery staple'

describe('backup crypto', () => {
  it('round-trips encrypt → decrypt back to the original bytes', () => {
    const plain = Buffer.from('the quick brown fox jumps over the lazy dog', 'utf8')
    const envelope = encryptArchive(plain, PASSWORD)
    const decrypted = decryptArchive(envelope, PASSWORD)
    expect(Buffer.compare(decrypted, plain)).toBe(0)
  })

  it('round-trips a Uint8Array input', () => {
    const plain = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255])
    const envelope = encryptArchive(plain, PASSWORD)
    const decrypted = decryptArchive(envelope, PASSWORD)
    expect(Buffer.compare(decrypted, Buffer.from(plain))).toBe(0)
  })

  it('isEncryptedArchive is true for encrypted output', () => {
    const envelope = encryptArchive(Buffer.from('hello'), PASSWORD)
    expect(isEncryptedArchive(envelope)).toBe(true)
    expect(isEncryptedArchive(new Uint8Array(envelope))).toBe(true)
  })

  it('isEncryptedArchive is false for a plain zip', () => {
    const zip = zipSync({ 'a.txt': Buffer.from('hi') })
    expect(isEncryptedArchive(zip)).toBe(false)
  })

  it('isEncryptedArchive is false for random / short bytes', () => {
    expect(isEncryptedArchive(new Uint8Array([1, 2, 3]))).toBe(false)
    expect(isEncryptedArchive(new Uint8Array(0))).toBe(false)
    // Long enough but wrong magic bytes.
    expect(isEncryptedArchive(new Uint8Array(64).fill(7))).toBe(false)
  })

  it('decryptArchive throws with a wrong password', () => {
    const envelope = encryptArchive(Buffer.from('secret payload'), PASSWORD)
    expect(() => decryptArchive(envelope, 'wrong password')).toThrow()
  })

  it('encrypting the same input twice yields different ciphertext (random salt/iv)', () => {
    const plain = Buffer.from('identical plaintext')
    const a = encryptArchive(plain, PASSWORD)
    const b = encryptArchive(plain, PASSWORD)
    expect(Buffer.compare(a, b)).not.toBe(0)
    // Both still decrypt back to the same plaintext.
    expect(Buffer.compare(decryptArchive(a, PASSWORD), plain)).toBe(0)
    expect(Buffer.compare(decryptArchive(b, PASSWORD), plain)).toBe(0)
  })
})
