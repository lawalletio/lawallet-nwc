import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn()
}))
vi.mock('@/lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }))
}))

import { getConfig } from '@/lib/config'
import { migrateRemoteWalletNwcConfigs } from '@/lib/wallet/migrate-remote-wallet-vault'
import {
  decryptRemoteWalletEnvelope,
  encryptRemoteWalletEnvelope
} from '@/lib/wallet/remote-wallet-vault-core'

const ACTIVE_SECRET =
  'active-remote-wallet-secret-0123456789abcdef0123456789abcdef'
const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'b'.repeat(64)

function mockVault(
  secret: string | null = ACTIVE_SECRET,
  previousSecrets: string[] = []
) {
  const configured = secret ?? undefined
  vi.mocked(getConfig).mockReturnValue({
    nwcVault: {
      secret: configured,
      previousSecrets,
      enabled: !!configured
    }
  } as never)
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  mockVault()
})

describe('RemoteWallet NWC startup migration', () => {
  it('encrypts every plaintext connection and stamps the row atomically', async () => {
    vi.mocked(prismaMock.remoteWallet.count).mockResolvedValue(1)
    vi.mocked(prismaMock.$queryRaw)
      .mockResolvedValueOnce([] as never) // advisory lock
      .mockResolvedValueOnce([
        {
          id: 'wallet-1',
          config: { connectionString: NWC_URI, mode: 'RECEIVE' },
          nwcConfigEncryptedAt: null
        }
      ] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)

    await expect(migrateRemoteWalletNwcConfigs()).resolves.toBe(1)

    expect(prismaMock.remoteWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: {
        config: {
          connectionString: expect.stringMatching(/^lwrw1:/),
          mode: 'RECEIVE'
        },
        nwcConfigEncryptedAt: expect.any(Date)
      }
    })
  })

  it('does not rewrite an already encrypted and stamped row', async () => {
    const stored = encryptRemoteWalletEnvelope(
      NWC_URI,
      'wallet-1',
      ACTIVE_SECRET
    )
    vi.mocked(prismaMock.remoteWallet.count).mockResolvedValue(1)
    vi.mocked(prismaMock.$queryRaw)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: 'wallet-1',
          config: { connectionString: stored, mode: 'RECEIVE' },
          nwcConfigEncryptedAt: new Date()
        }
      ] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)

    await expect(migrateRemoteWalletNwcConfigs()).resolves.toBe(0)
    expect(prismaMock.remoteWallet.update).not.toHaveBeenCalled()
  })

  it('rewrites an envelope that still uses a previous rotation key', async () => {
    const oldSecret =
      'previous-remote-wallet-secret-0123456789abcdef0123456789abcd'
    const stored = encryptRemoteWalletEnvelope(NWC_URI, 'wallet-1', oldSecret)
    mockVault(ACTIVE_SECRET, [oldSecret])
    vi.mocked(prismaMock.remoteWallet.count).mockResolvedValue(1)
    vi.mocked(prismaMock.$queryRaw)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: 'wallet-1',
          config: { connectionString: stored, mode: 'RECEIVE' },
          nwcConfigEncryptedAt: new Date()
        }
      ] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)

    await expect(migrateRemoteWalletNwcConfigs()).resolves.toBe(1)
    const update = vi.mocked(prismaMock.remoteWallet.update).mock.calls[0][0]
    const rotated = (update.data.config as { connectionString: string })
      .connectionString
    expect(rotated).not.toBe(stored)
    expect(
      decryptRemoteWalletEnvelope(rotated, 'wallet-1', [ACTIVE_SECRET])
    ).toBe(NWC_URI)
  })

  it('fails closed when NWC rows exist without the vault key', async () => {
    mockVault(null)
    vi.mocked(prismaMock.remoteWallet.count).mockResolvedValue(1)

    await expect(migrateRemoteWalletNwcConfigs()).rejects.toThrow(
      'NWC_VAULT_SECRET is required'
    )
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('does not require the vault on an installation with no NWC wallets', async () => {
    mockVault(null)
    vi.mocked(prismaMock.remoteWallet.count).mockResolvedValue(0)
    await expect(migrateRemoteWalletNwcConfigs()).resolves.toBe(0)
  })
})
