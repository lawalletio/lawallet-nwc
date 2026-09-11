import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto'
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
import { migrateProxyNwcVault } from '@/lib/proxy/migrate-nwc-vault'
import { encryptNwcVaultEnvelope } from '@/lib/wallet/remote-wallet-vault-core'

const ACTIVE_SECRET =
  'active-proxy-vault-secret-0123456789abcdef0123456789abcdef'
const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'b'.repeat(64)
const NSEC_HEX = '1'.repeat(64)

function mockVault(secret: string | null = ACTIVE_SECRET) {
  const configured = secret ?? undefined
  vi.mocked(getConfig).mockReturnValue({
    nwcVault: {
      secret: configured,
      enabled: !!configured
    }
  } as never)
}

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

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  mockVault()
})

describe('ProxyServiceConfig NWC vault migration', () => {
  it('converts a legacy LWPX01 NWC blob to lwrw1', async () => {
    const legacy = encryptLegacyProxy(NWC_URI, 'default', 'nwc', ACTIVE_SECRET)
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      id: 'default',
      nwcCiphertext: legacy,
      receiptNsecCiphertext: null
    } as never)

    await migrateProxyNwcVault()

    expect(prismaMock.proxyServiceConfig.update).toHaveBeenCalledWith({
      where: { id: 'default' },
      data: {
        nwcCiphertext: expect.any(Uint8Array)
      }
    })
    const written = vi.mocked(prismaMock.proxyServiceConfig.update).mock
      .calls[0][0].data.nwcCiphertext as Uint8Array
    expect(Buffer.from(written).toString('utf8').startsWith('lwrw1:')).toBe(
      true
    )
  })

  it('does not rewrite a canonical lwrw1 envelope', async () => {
    const canonical = Uint8Array.from(
      Buffer.from(
        encryptNwcVaultEnvelope(NWC_URI, 'default', 'nwc', ACTIVE_SECRET),
        'utf8'
      )
    )
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      id: 'default',
      nwcCiphertext: canonical,
      receiptNsecCiphertext: null
    } as never)

    await migrateProxyNwcVault()
    expect(prismaMock.proxyServiceConfig.update).not.toHaveBeenCalled()
  })

  it('fails closed when proxy NWC cannot be decrypted', async () => {
    const sealed = encryptLegacyProxy(
      NWC_URI,
      'default',
      'nwc',
      'other-proxy-vault-secret-0123456789abcdef0123456789abcdef'
    )
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      id: 'default',
      nwcCiphertext: sealed,
      receiptNsecCiphertext: null
    } as never)

    await expect(migrateProxyNwcVault()).rejects.toThrow(
      'cannot be decrypted with the current NWC_VAULT_SECRET'
    )
  })

  it('skips an unreadable receipt nsec without failing boot', async () => {
    const nwc = Uint8Array.from(
      Buffer.from(
        encryptNwcVaultEnvelope(NWC_URI, 'default', 'nwc', ACTIVE_SECRET),
        'utf8'
      )
    )
    const badNsec = encryptLegacyProxy(
      NSEC_HEX,
      'default',
      'receipt-nsec',
      'other-proxy-vault-secret-0123456789abcdef0123456789abcdef'
    )
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      id: 'default',
      nwcCiphertext: nwc,
      receiptNsecCiphertext: badNsec
    } as never)

    await expect(migrateProxyNwcVault()).resolves.toBeUndefined()
    expect(prismaMock.proxyServiceConfig.update).not.toHaveBeenCalled()
  })

  it('fails closed when ciphertext exists without the vault key', async () => {
    mockVault(null)
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      id: 'default',
      nwcCiphertext: Uint8Array.from([1]),
      receiptNsecCiphertext: null
    } as never)

    await expect(migrateProxyNwcVault()).rejects.toThrow(
      'NWC_VAULT_SECRET is not configured'
    )
  })
})
