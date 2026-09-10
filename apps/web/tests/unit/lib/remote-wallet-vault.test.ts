import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))

import { getConfig } from '@/lib/config'
import { DriverConfigError } from '@/lib/wallet/drivers/errors'
import {
  decryptRemoteWalletConfig,
  decryptRemoteWalletConfigForDriver,
  decryptRemoteWalletConnectionString,
  encryptRemoteWalletConfig,
  encryptRemoteWalletConnectionString,
  isEncryptedRemoteWalletConnectionString,
  RemoteWalletVaultDecryptError
} from '@/lib/wallet/remote-wallet-vault'

const ACTIVE_SECRET =
  'active-remote-wallet-secret-0123456789abcdef0123456789abcdef'
const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'b'.repeat(64)

function mockVault(secret: string | undefined) {
  vi.mocked(getConfig).mockReturnValue({
    nwcVault: { secret, enabled: !!secret }
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

  it('passes a legacy plaintext value through for rolling migration', () => {
    mockVault(undefined)
    expect(decryptRemoteWalletConnectionString(NWC_URI, 'legacy-wallet')).toBe(
      NWC_URI
    )
  })

  it('maps a corrupt vault envelope to DriverConfigError for driver callers', () => {
    expect(() =>
      decryptRemoteWalletConfigForDriver('wallet-1', 'NWC', {
        connectionString: 'lwrw1:not-a-valid-envelope'
      })
    ).toThrow(DriverConfigError)
  })

  it('does not map a missing NWC_VAULT_SECRET to DriverConfigError', () => {
    mockVault(undefined)
    try {
      decryptRemoteWalletConfigForDriver('wallet-1', 'NWC', {
        connectionString: 'lwrw1:not-a-valid-envelope'
      })
      throw new Error('should have thrown')
    } catch (err) {
      expect(err).not.toBeInstanceOf(DriverConfigError)
      expect((err as Error).message).toBe('NWC_VAULT_SECRET is not configured')
    }
  })
})
