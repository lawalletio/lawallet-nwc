import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const mocks = vi.hoisted(() => ({
  encrypt: vi.fn(() => Uint8Array.from([1, 2, 3])),
  decrypt: vi.fn(),
  generatePrivateKey: vi.fn(() => '1'.repeat(64)),
  receiptPubkey: vi.fn(() => '2'.repeat(64)),
  logInfo: vi.fn(),
  logWarn: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    nwcVault: { enabled: true, secret: 'vault-secret' }
  }))
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: mocks.logInfo, warn: mocks.logWarn })
}))

vi.mock('@/lib/nostr', () => ({
  generatePrivateKey: mocks.generatePrivateKey
}))

vi.mock('@/lib/proxy/nostr', () => ({
  receiptPubkey: mocks.receiptPubkey
}))

vi.mock('@/lib/proxy/vault', () => ({
  encryptProxySecret: mocks.encrypt,
  decryptProxySecret: mocks.decrypt
}))

import { getConfig } from '@/lib/config'
import { ensureZapReceiptSigner } from '@/lib/proxy/initialize-receipt-signer'

const SEALED = Uint8Array.from([9, 9, 9])

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(getConfig).mockReturnValue({
    nwcVault: { enabled: true, secret: 'vault-secret' }
  } as never)
  mocks.decrypt.mockReturnValue('1'.repeat(64))
  vi.mocked(prismaMock.proxyServiceConfig.updateMany).mockResolvedValue({
    count: 1
  } as never)
})

describe('zap receipt signer health', () => {
  it('creates a disabled proxy config with an encrypted random signer', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.proxyServiceConfig.createMany).mockResolvedValue({
      count: 1
    })

    await expect(ensureZapReceiptSigner()).resolves.toBe(true)

    expect(mocks.encrypt).toHaveBeenCalledWith(
      '1'.repeat(64),
      'default',
      'receipt-nsec'
    )
    expect(prismaMock.proxyServiceConfig.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: 'default',
          enabled: false,
          feeBps: 50,
          walletId: '__lawallet_proxy__',
          receiptNsecCiphertext: Uint8Array.from([1, 2, 3]),
          receiptPubkey: '2'.repeat(64)
        }
      ],
      skipDuplicates: true
    })
    expect(mocks.logInfo).toHaveBeenCalledWith(
      { receiptPubkey: '2'.repeat(64) },
      'proxy_receipt_signer.initialized'
    )
  })

  it('leaves a healthy signer alone', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      id: 'default',
      receiptNsecCiphertext: SEALED,
      receiptPubkey: 'a'.repeat(64)
    } as never)

    await expect(ensureZapReceiptSigner()).resolves.toBe(false)

    expect(mocks.generatePrivateKey).not.toHaveBeenCalled()
    expect(prismaMock.proxyServiceConfig.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.proxyServiceConfig.update).not.toHaveBeenCalled()
  })

  it('generates a signer for a config row that has none', async () => {
    // The settings route can create the row without a signer, and the old
    // initializer skipped any existing row — leaving zaps off for good.
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      id: 'default',
      receiptNsecCiphertext: null,
      receiptPubkey: null
    } as never)

    await expect(ensureZapReceiptSigner()).resolves.toBe(true)

    expect(prismaMock.proxyServiceConfig.updateMany).toHaveBeenCalledWith({
      where: { id: 'default', receiptNsecCiphertext: null },
      data: {
        receiptNsecCiphertext: Uint8Array.from([1, 2, 3]),
        receiptPubkey: '2'.repeat(64)
      }
    })
  })

  it('derives a missing pubkey instead of replacing a readable signer', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      id: 'default',
      receiptNsecCiphertext: SEALED,
      receiptPubkey: null
    } as never)

    await expect(ensureZapReceiptSigner()).resolves.toBe(true)

    expect(prismaMock.proxyServiceConfig.update).toHaveBeenCalledWith({
      where: { id: 'default' },
      data: { receiptPubkey: '2'.repeat(64) }
    })
    expect(mocks.generatePrivateKey).not.toHaveBeenCalled()
  })

  it('replaces a signer the secret cannot open', async () => {
    mocks.decrypt.mockImplementation(() => {
      throw new Error('Proxy vault decryption failed')
    })
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      id: 'default',
      receiptNsecCiphertext: SEALED,
      receiptPubkey: 'a'.repeat(64)
    } as never)

    await expect(ensureZapReceiptSigner()).resolves.toBe(true)

    expect(prismaMock.proxyServiceConfig.updateMany).toHaveBeenCalledWith({
      // Guarded on the ciphertext we read, so concurrent cold starts cannot
      // each install a different key.
      where: { id: 'default', receiptNsecCiphertext: SEALED },
      data: {
        receiptNsecCiphertext: Uint8Array.from([1, 2, 3]),
        receiptPubkey: '2'.repeat(64)
      }
    })
    expect(mocks.logWarn).toHaveBeenCalledWith(
      {
        proxyConfigId: 'default',
        previousReceiptPubkey: 'a'.repeat(64),
        receiptPubkey: '2'.repeat(64)
      },
      'proxy_receipt_signer.replaced_unreadable'
    )
  })

  it('waits for NWC_VAULT_SECRET instead of storing plaintext', async () => {
    vi.mocked(getConfig).mockReturnValue({
      nwcVault: { enabled: false, secret: undefined }
    } as never)

    await expect(ensureZapReceiptSigner()).resolves.toBe(false)

    expect(prismaMock.proxyServiceConfig.findUnique).not.toHaveBeenCalled()
    expect(mocks.encrypt).not.toHaveBeenCalled()
  })

  it('handles concurrent cold starts without reporting a second initializer', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.proxyServiceConfig.createMany).mockResolvedValue({
      count: 0
    })

    await expect(ensureZapReceiptSigner()).resolves.toBe(false)
    expect(mocks.logInfo).not.toHaveBeenCalled()
  })
})
