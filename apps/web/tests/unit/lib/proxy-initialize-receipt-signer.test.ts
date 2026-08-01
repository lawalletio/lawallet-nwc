import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const mocks = vi.hoisted(() => ({
  encrypt: vi.fn(() => Uint8Array.from([1, 2, 3])),
  generatePrivateKey: vi.fn(() => '1'.repeat(64)),
  receiptPubkey: vi.fn(() => '2'.repeat(64)),
  logInfo: vi.fn()
}))

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    nwcVault: { enabled: true, secret: 'vault-secret' }
  }))
}))

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: mocks.logInfo })
}))

vi.mock('@/lib/nostr', () => ({
  generatePrivateKey: mocks.generatePrivateKey
}))

vi.mock('@/lib/proxy/nostr', () => ({
  receiptPubkey: mocks.receiptPubkey
}))

vi.mock('@/lib/proxy/vault', () => ({
  encryptProxySecret: mocks.encrypt
}))

import { getConfig } from '@/lib/config'
import { initializeProxyReceiptSigner } from '@/lib/proxy/initialize-receipt-signer'

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(getConfig).mockReturnValue({
    nwcVault: { enabled: true, secret: 'vault-secret' }
  } as never)
})

describe('proxy receipt signer initialization', () => {
  it('creates a disabled proxy config with an encrypted random signer', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.proxyServiceConfig.createMany).mockResolvedValue({
      count: 1
    })

    await expect(initializeProxyReceiptSigner()).resolves.toBe(true)

    expect(mocks.generatePrivateKey).toHaveBeenCalledOnce()
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

  it('never overwrites an existing config or user-rotated signer', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      id: 'default'
    } as never)

    await expect(initializeProxyReceiptSigner()).resolves.toBe(false)

    expect(mocks.generatePrivateKey).not.toHaveBeenCalled()
    expect(prismaMock.proxyServiceConfig.createMany).not.toHaveBeenCalled()
  })

  it('waits for NWC_VAULT_SECRET instead of storing plaintext', async () => {
    vi.mocked(getConfig).mockReturnValue({
      nwcVault: { enabled: false, secret: undefined }
    } as never)

    await expect(initializeProxyReceiptSigner()).resolves.toBe(false)

    expect(prismaMock.proxyServiceConfig.findUnique).not.toHaveBeenCalled()
    expect(mocks.generatePrivateKey).not.toHaveBeenCalled()
    expect(mocks.encrypt).not.toHaveBeenCalled()
  })

  it('handles concurrent cold starts without reporting a second initializer', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.proxyServiceConfig.createMany).mockResolvedValue({
      count: 0
    })

    await expect(initializeProxyReceiptSigner()).resolves.toBe(false)
    expect(mocks.logInfo).not.toHaveBeenCalled()
  })
})
