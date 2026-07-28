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
const OLD_SECRET = 'previous-proxy-vault-secret-0123456789abcdef0123456789abcd'
const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'b'.repeat(64)

function mockVault(secret: string | undefined, previousSecrets: string[] = []) {
  vi.mocked(getConfig).mockReturnValue({
    nwcVault: { secret, previousSecrets, enabled: !!secret }
  } as never)
}

describe('proxy vault', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVault(ACTIVE_SECRET)
  })

  it('round-trips a write-only proxy credential', () => {
    const envelope = encryptProxySecret(NWC_URI, 'default', 'nwc')
    expect(decryptProxySecret(envelope, 'default', 'nwc')).toBe(NWC_URI)
    expect(isProxyVaultConfigured()).toBe(true)
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

  it('accepts the previous key during a vault-key rotation', () => {
    mockVault(OLD_SECRET)
    const envelope = encryptProxySecret(NWC_URI, 'default', 'nwc')

    mockVault(ACTIVE_SECRET, [OLD_SECRET])
    expect(decryptProxySecret(envelope, 'default', 'nwc')).toBe(NWC_URI)
  })
})
