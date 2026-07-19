import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}))

import {
  decryptNsec,
  encryptNsec,
  isVaultConfigured,
  rotateEnvelope,
  VaultDecryptError,
} from '@/lib/auth/key-vault'
import { getConfig } from '@/lib/config'

const ACTIVE_SECRET = 'active-vault-secret-0123456789abcdef0123456789abcdef'
const OLD_SECRET = 'previous-vault-secret-0123456789abcdef0123456789abcd'
const USER_ID = '9c5b94b1-35ad-49bb-b118-8e8fc24abf80'
const PRIVKEY = 'a'.repeat(32) + '0123456789abcdef0123456789abcdef'

function mockVault(secret: string | undefined, previousSecrets: string[] = []) {
  vi.mocked(getConfig).mockReturnValue({
    keyVault: { secret, previousSecrets, enabled: !!secret },
  } as any)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockVault(ACTIVE_SECRET)
})

describe('key-vault', () => {
  it('reports configuration state', () => {
    expect(isVaultConfigured()).toBe(true)
    mockVault(undefined)
    expect(isVaultConfigured()).toBe(false)
  })

  it('round-trips a private key', () => {
    const envelope = encryptNsec(PRIVKEY, USER_ID)
    expect(decryptNsec(envelope, USER_ID)).toBe(PRIVKEY)
  })

  it('produces distinct envelopes for the same plaintext (random salt/iv)', () => {
    const a = encryptNsec(PRIVKEY, USER_ID)
    const b = encryptNsec(PRIVKEY, USER_ID)
    expect(a.equals(b)).toBe(false)
    expect(decryptNsec(a, USER_ID)).toBe(PRIVKEY)
    expect(decryptNsec(b, USER_ID)).toBe(PRIVKEY)
  })

  it('rejects a non-hex private key', () => {
    expect(() => encryptNsec('nsec1notahexkey', USER_ID)).toThrow()
    expect(() => encryptNsec(PRIVKEY.slice(0, 63), USER_ID)).toThrow()
  })

  it('throws when the vault is not configured', () => {
    mockVault(undefined)
    expect(() => encryptNsec(PRIVKEY, USER_ID)).toThrow('KEY_VAULT_SECRET')
    expect(() => decryptNsec(Buffer.alloc(100), USER_ID)).toThrow(
      'KEY_VAULT_SECRET'
    )
  })

  it('fails on ciphertext tampering', () => {
    const envelope = encryptNsec(PRIVKEY, USER_ID)
    envelope[envelope.length - 1] ^= 0xff
    expect(() => decryptNsec(envelope, USER_ID)).toThrow(VaultDecryptError)
  })

  it('fails on a wrong secret', () => {
    const envelope = encryptNsec(PRIVKEY, USER_ID)
    mockVault(OLD_SECRET)
    expect(() => decryptNsec(envelope, USER_ID)).toThrow(VaultDecryptError)
  })

  it('fails when the envelope is bound to another user (AAD mismatch)', () => {
    const envelope = encryptNsec(PRIVKEY, USER_ID)
    expect(() => decryptNsec(envelope, 'some-other-user-id')).toThrow(
      VaultDecryptError
    )
  })

  it('fails on a malformed envelope', () => {
    expect(() => decryptNsec(Buffer.from('too short'), USER_ID)).toThrow(
      VaultDecryptError
    )
    const envelope = encryptNsec(PRIVKEY, USER_ID)
    envelope.write('XXXXXX', 0, 'utf8') // clobber the magic
    expect(() => decryptNsec(envelope, USER_ID)).toThrow(VaultDecryptError)
  })

  it('falls back to previous secrets during rotation', () => {
    mockVault(OLD_SECRET)
    const envelope = encryptNsec(PRIVKEY, USER_ID)

    mockVault(ACTIVE_SECRET, [OLD_SECRET])
    expect(decryptNsec(envelope, USER_ID)).toBe(PRIVKEY)
  })

  it('rotateEnvelope re-encrypts under the active secret', () => {
    mockVault(OLD_SECRET)
    const oldEnvelope = encryptNsec(PRIVKEY, USER_ID)

    mockVault(ACTIVE_SECRET, [OLD_SECRET])
    const rotated = rotateEnvelope(oldEnvelope, USER_ID)

    // The rotated envelope must decrypt WITHOUT the previous secret.
    mockVault(ACTIVE_SECRET)
    expect(decryptNsec(rotated, USER_ID)).toBe(PRIVKEY)
    expect(() => decryptNsec(oldEnvelope, USER_ID)).toThrow(VaultDecryptError)
  })
})
