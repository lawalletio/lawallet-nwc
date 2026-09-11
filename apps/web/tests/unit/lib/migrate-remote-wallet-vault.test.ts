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
import { encryptRemoteWalletEnvelope } from '@/lib/wallet/remote-wallet-vault-core'

const ACTIVE_SECRET =
  'active-remote-wallet-secret-0123456789abcdef0123456789abcdef'
const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'b'.repeat(64)

function mockVault(secret: string | null = ACTIVE_SECRET) {
  const configured = secret ?? undefined
  vi.mocked(getConfig).mockReturnValue({
    nwcVault: { secret: configured, enabled: !!configured }
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

  it('reports a row sealed under another secret without failing startup', async () => {
    const stored = encryptRemoteWalletEnvelope(
      NWC_URI,
      'wallet-1',
      'other-remote-wallet-secret-0123456789abcdef0123456789abcdef'
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

    // One user's unrecoverable wallet degrades to a 503 on that wallet's
    // driver path; it must not take the whole instance down.
    await expect(migrateRemoteWalletNwcConfigs()).resolves.toBe(0)
    expect(prismaMock.remoteWallet.update).not.toHaveBeenCalled()
  })

  it('stamps an unreadable envelope instead of retrying it every boot', async () => {
    const stored = encryptRemoteWalletEnvelope(
      NWC_URI,
      'wallet-1',
      'other-remote-wallet-secret-0123456789abcdef0123456789abcdef'
    )
    vi.mocked(prismaMock.remoteWallet.count).mockResolvedValue(1)
    vi.mocked(prismaMock.$queryRaw)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: 'wallet-1',
          config: { connectionString: stored, mode: 'RECEIVE' },
          nwcConfigEncryptedAt: null
        }
      ] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)

    await expect(migrateRemoteWalletNwcConfigs()).resolves.toBe(1)
    expect(prismaMock.remoteWallet.update).toHaveBeenCalledWith({
      where: { id: 'wallet-1' },
      data: { nwcConfigEncryptedAt: expect.any(Date) }
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
      .mockResolvedValueOnce([] as never) // advisory lock
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

  it('processes multiple rows in batches', async () => {
    vi.mocked(prismaMock.remoteWallet.count).mockResolvedValue(3)
    vi.mocked(prismaMock.$queryRaw)
      .mockResolvedValueOnce([] as never) // advisory lock batch 1
      .mockResolvedValueOnce([
        {
          id: 'wallet-1',
          config: { connectionString: NWC_URI, mode: 'RECEIVE' },
          nwcConfigEncryptedAt: null
        },
        {
          id: 'wallet-2',
          config: { connectionString: NWC_URI, mode: 'PAY' },
          nwcConfigEncryptedAt: null
        },
        {
          id: 'wallet-3',
          config: { connectionString: NWC_URI, mode: 'FULL' },
          nwcConfigEncryptedAt: null
        }
      ] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)

    await expect(migrateRemoteWalletNwcConfigs()).resolves.toBe(3)

    expect(prismaMock.remoteWallet.update).toHaveBeenCalledTimes(3)
  })

  it('continues processing after batch boundary', async () => {
    vi.mocked(prismaMock.remoteWallet.count).mockResolvedValue(51)
    vi.mocked(prismaMock.$queryRaw)
      // First batch
      .mockResolvedValueOnce([] as never) // advisory lock
      .mockResolvedValueOnce(
        Array.from({ length: 50 }, (_, i) => ({
          id: `wallet-${i + 1}`,
          config: { connectionString: NWC_URI, mode: 'RECEIVE' },
          nwcConfigEncryptedAt: null
        })) as never
      )
      // Second batch
      .mockResolvedValueOnce([] as never) // advisory lock
      .mockResolvedValueOnce([
        {
          id: 'wallet-51',
          config: { connectionString: NWC_URI, mode: 'RECEIVE' },
          nwcConfigEncryptedAt: null
        }
      ] as never)
      // Verification
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)

    await expect(migrateRemoteWalletNwcConfigs()).resolves.toBe(51)
    expect(prismaMock.remoteWallet.update).toHaveBeenCalledTimes(51)
  })

  it('retries on transaction timeout', async () => {
    vi.mocked(prismaMock.remoteWallet.count).mockResolvedValue(1)

    let callCount = 0
    vi.mocked(prismaMock.$transaction).mockImplementation(async fn => {
      callCount++
      if (callCount === 1) {
        throw new Error(
          'Transaction already closed: A query cannot be executed on an expired transaction. ' +
            'The timeout for this transaction was 30000 ms, however 35000 ms passed since the start of the transaction.'
        )
      }
      // Second call succeeds
      return (fn as Function)({
        $queryRaw: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: 'wallet-1',
              config: { connectionString: NWC_URI, mode: 'RECEIVE' },
              nwcConfigEncryptedAt: null
            }
          ]),
        remoteWallet: {
          update: vi.fn().mockResolvedValue({})
        }
      })
    })

    vi.mocked(prismaMock.$queryRaw).mockResolvedValueOnce([
      { count: BigInt(0) }
    ] as never)

    await expect(migrateRemoteWalletNwcConfigs()).resolves.toBe(1)
    expect(callCount).toBe(2)
  })

  it('fails after max retries', async () => {
    vi.mocked(prismaMock.remoteWallet.count).mockResolvedValue(1)
    vi.mocked(prismaMock.$transaction).mockRejectedValue(
      new Error(
        'Transaction already closed: A query cannot be executed on an expired transaction. ' +
          'The timeout for this transaction was 30000 ms, however 35000 ms passed since the start of the transaction.'
      )
    )

    await expect(migrateRemoteWalletNwcConfigs()).rejects.toThrow(
      'Database transaction timed out'
    )
  })

  it('skips rows with missing connectionString', async () => {
    vi.mocked(prismaMock.remoteWallet.count).mockResolvedValue(2)
    vi.mocked(prismaMock.$queryRaw)
      .mockResolvedValueOnce([] as never) // advisory lock
      .mockResolvedValueOnce([
        {
          id: 'wallet-1',
          config: { connectionString: NWC_URI, mode: 'RECEIVE' },
          nwcConfigEncryptedAt: null
        },
        {
          id: 'wallet-2',
          config: { mode: 'PAY' }, // missing connectionString
          nwcConfigEncryptedAt: null
        }
      ] as never)
      .mockResolvedValueOnce([{ count: BigInt(0) }] as never)

    await expect(migrateRemoteWalletNwcConfigs()).rejects.toThrow(
      'no valid config.connectionString'
    )
  })
})
