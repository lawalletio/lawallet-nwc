import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

import { getConfig } from '@/lib/config'
import {
  decryptRemoteWalletConfig,
  decryptRemoteWalletConnectionString,
  encryptRemoteWalletConfig,
  encryptRemoteWalletConnectionString,
  isEncryptedRemoteWalletConnectionString,
  RemoteWalletVaultDecryptError
} from '@/lib/wallet/remote-wallet-vault'

const ACTIVE_SECRET =
  'active-remote-wallet-secret-0123456789abcdef0123456789abcdef'
const OLD_SECRET =
  'previous-remote-wallet-secret-0123456789abcdef0123456789abcd'
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

describe('remote wallet NWC vault', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockVault(ACTIVE_SECRET)
  })

  it('encrypts only the NWC connection string and round-trips the config', () => {
    const plaintext = {
      connectionString: NWC_URI,
      mode: 'SEND_RECEIVE',
      provider: 'lncurl'
    }
    const stored = encryptRemoteWalletConfig('wallet-1', 'NWC', plaintext)

    expect(
      isEncryptedRemoteWalletConnectionString(stored.connectionString)
    ).toBe(true)
    expect(stored.connectionString).not.toContain(NWC_URI)
    expect(stored.mode).toBe('SEND_RECEIVE')
    expect(stored.provider).toBe('lncurl')
    expect(decryptRemoteWalletConfig('wallet-1', 'NWC', stored)).toEqual(
      plaintext
    )
  })

  it('does not double-encrypt an existing valid envelope', () => {
    const once = encryptRemoteWalletConfig('wallet-1', 'NWC', {
      connectionString: NWC_URI,
      mode: 'RECEIVE'
    })
    const twice = encryptRemoteWalletConfig('wallet-1', 'NWC', once)
    expect(twice).toEqual(once)
  })

  it('binds ciphertext to its RemoteWallet id', () => {
    const envelope = encryptRemoteWalletConnectionString(NWC_URI, 'wallet-1')
    expect(() =>
      decryptRemoteWalletConnectionString(envelope, 'wallet-2')
    ).toThrow(RemoteWalletVaultDecryptError)
  })

  it('accepts the previous key during vault rotation', () => {
    mockVault(OLD_SECRET)
    const envelope = encryptRemoteWalletConnectionString(NWC_URI, 'wallet-1')

    mockVault(ACTIVE_SECRET, [OLD_SECRET])
    expect(decryptRemoteWalletConnectionString(envelope, 'wallet-1')).toBe(
      NWC_URI
    )
  })

  it('passes a legacy plaintext value through for rolling migration', () => {
    mockVault(undefined)
    expect(decryptRemoteWalletConnectionString(NWC_URI, 'legacy-wallet')).toBe(
      NWC_URI
    )
  })
})
