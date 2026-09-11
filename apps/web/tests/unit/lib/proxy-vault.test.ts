import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

import { getConfig } from '@/lib/config'
import {
  decryptProxySecret,
  encryptProxySecret,
  isProxyVaultConfigured,
  ProxyVaultDecryptError
} from '@/lib/proxy/vault'

const ACTIVE_SECRET =
  'active-proxy-vault-secret-0123456789abcdef0123456789abcdef'
const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'b'.repeat(64)

function encryptLegacyProxy(
  plaintext: string,
  recordId: string,
  field: string,
  secret: string
): Uint8Array {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = Buffer.from(
    hkdfSync('sha256', secret, salt, 'lawallet-proxy-vault-v1', 32)
  )
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${recordId}:${field}`, 'utf8'))
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final()
  ])
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from('LWPX01', 'utf8'),
      salt,
      iv,
      cipher.getAuthTag(),
      ciphertext
    ])
  )
}

function mockVault(secret: string | undefined) {
  vi.mocked(getConfig).mockReturnValue({
    nwcVault: { previousSecrets: [], secret, enabled: !!secret }
  } as never)
}

describe('proxy vault', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVault(ACTIVE_SECRET)
  })

  it('round-trips a write-only proxy credential as lwrw1', () => {
    const envelope = encryptProxySecret(NWC_URI, 'default', 'nwc')
    expect(Buffer.from(envelope).toString('utf8').startsWith('lwrw1:')).toBe(
      true
    )
    expect(decryptProxySecret(envelope, 'default', 'nwc')).toBe(NWC_URI)
    expect(isProxyVaultConfigured()).toBe(true)
  })

  it('still decrypts a legacy LWPX01 envelope', () => {
    const envelope = encryptLegacyProxy(
      NWC_URI,
      'default',
      'nwc',
      ACTIVE_SECRET
    )
    expect(decryptProxySecret(envelope, 'default', 'nwc')).toBe(NWC_URI)
  })

  it('binds ciphertext to the record and field through authenticated data', () => {
    const envelope = encryptProxySecret(NWC_URI, 'default', 'nwc')
    expect(() => decryptProxySecret(envelope, 'different', 'nwc')).toThrow(
      ProxyVaultDecryptError
    )
    expect(() =>
      decryptProxySecret(envelope, 'default', 'receipt-nsec')
    ).toThrow(ProxyVaultDecryptError)
  })

  it('detects ciphertext tampering', () => {
    const envelope = encryptProxySecret(NWC_URI, 'default', 'nwc')
    envelope[envelope.length - 1] ^= 0xff
    expect(() => decryptProxySecret(envelope, 'default', 'nwc')).toThrow(
      ProxyVaultDecryptError
    )
  })
})
