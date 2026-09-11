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
vi.mock('@/lib/nostr', () => ({
  generatePrivateKey: vi.fn(() => 'c'.repeat(64))
}))
vi.mock('@/lib/proxy/nostr', () => ({
  receiptPubkey: vi.fn(() => 'd'.repeat(64))
}))

import { getConfig } from '@/lib/config'
import { migrateProxyNwcVault } from '@/lib/proxy/migrate-nwc-vault'
import { decryptProxySecret } from '@/lib/proxy/vault'
import { encryptNwcVaultEnvelope } from '@/lib/wallet/remote-wallet-vault-core'

const ACTIVE_SECRET =
  'active-proxy-vault-secret-0123456789abcdef0123456789abcdef'
const OTHER_SECRET =
  'retired-proxy-vault-secret-0123456789abcdef0123456789abcdef'
const NWC_URI =
  'nostr+walletconnect://' +
  'a'.repeat(64) +
  '?relay=wss%3A%2F%2Frelay.example&secret=' +
  'b'.repeat(64)
const NSEC_HEX = '1'.repeat(64)

function mockVault(secret: string | null = ACTIVE_SECRET) {
  const configured = secret ?? undefined
  vi.mocked(getConfig).mockReturnValue({
    nwcVault: { secret: configured, enabled: !!configured }
  } as never)
}

function canonical(
  plaintext: string,
  field: string,
  secret = ACTIVE_SECRET
): Uint8Array {
  return Uint8Array.from(
    Buffer.from(
      encryptNwcVaultEnvelope(plaintext, 'default', field, secret),
      'utf8'
    )
  )
}

function legacy(
  plaintext: string,
  field: string,
  secret = ACTIVE_SECRET
): Uint8Array {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = Buffer.from(
    hkdfSync('sha256', secret, salt, 'lawallet-proxy-vault-v1', 32)
  )
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`default:${field}`, 'utf8'))
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

function mockRow(row: {
  nwcCiphertext?: Uint8Array | null
  receiptNsecCiphertext?: Uint8Array | null
  receiptPubkey?: string | null
}) {
  vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
    id: 'default',
    nwcCiphertext: row.nwcCiphertext ?? null,
    receiptNsecCiphertext: row.receiptNsecCiphertext ?? null,
    receiptPubkey: row.receiptPubkey ?? null
  } as never)
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  mockVault()
  vi.mocked(prismaMock.proxyServiceConfig.updateMany).mockResolvedValue({
    count: 1
  } as never)
})

describe('ProxyServiceConfig NWC vault migration', () => {
  it('converts a legacy LWPX01 NWC blob to the canonical envelope', async () => {
    mockRow({ nwcCiphertext: legacy(NWC_URI, 'nwc') })

    await migrateProxyNwcVault()

    const written = vi.mocked(prismaMock.proxyServiceConfig.update).mock
      .calls[0][0].data.nwcCiphertext as Uint8Array
    expect(Buffer.from(written).toString('utf8').startsWith('lwrw1:')).toBe(
      true
    )
    expect(decryptProxySecret(written, 'default', 'nwc')).toBe(NWC_URI)
  })

  it('leaves an already canonical envelope untouched', async () => {
    mockRow({
      nwcCiphertext: canonical(NWC_URI, 'nwc'),
      receiptNsecCiphertext: canonical(NSEC_HEX, 'receipt-nsec'),
      receiptPubkey: 'a'.repeat(64)
    })

    await migrateProxyNwcVault()

    expect(prismaMock.proxyServiceConfig.update).not.toHaveBeenCalled()
    expect(prismaMock.proxyServiceConfig.updateMany).not.toHaveBeenCalled()
  })

  it('converts a legacy receipt nsec without replacing the signer', async () => {
    mockRow({
      receiptNsecCiphertext: legacy(NSEC_HEX, 'receipt-nsec'),
      receiptPubkey: 'a'.repeat(64)
    })

    await migrateProxyNwcVault()

    const written = vi.mocked(prismaMock.proxyServiceConfig.update).mock
      .calls[0][0].data.receiptNsecCiphertext as Uint8Array
    expect(decryptProxySecret(written, 'default', 'receipt-nsec')).toBe(
      NSEC_HEX
    )
    expect(prismaMock.proxyServiceConfig.updateMany).not.toHaveBeenCalled()
  })

  it('restores NIP-57 by replacing a signer the active secret cannot open', async () => {
    const stale = legacy(NSEC_HEX, 'receipt-nsec', OTHER_SECRET)
    mockRow({
      nwcCiphertext: canonical(NWC_URI, 'nwc'),
      receiptNsecCiphertext: stale,
      receiptPubkey: 'a'.repeat(64)
    })

    await migrateProxyNwcVault()

    const call = vi.mocked(prismaMock.proxyServiceConfig.updateMany).mock
      .calls[0][0]
    // Guarded on the ciphertext we read, so concurrent cold starts cannot
    // each install a different key.
    expect(call.where).toEqual({
      id: 'default',
      receiptNsecCiphertext: stale
    })
    expect(call.data.receiptPubkey).toBe('d'.repeat(64))
    expect(
      decryptProxySecret(
        call.data.receiptNsecCiphertext as Uint8Array,
        'default',
        'receipt-nsec'
      )
    ).toBe('c'.repeat(64))
  })

  it('retains the displaced signer instead of overwriting it', async () => {
    const stale = legacy(NSEC_HEX, 'receipt-nsec', OTHER_SECRET)
    mockRow({
      receiptNsecCiphertext: stale,
      receiptPubkey: 'a'.repeat(64)
    })

    await migrateProxyNwcVault()

    const { data } = vi.mocked(prismaMock.proxyServiceConfig.updateMany).mock
      .calls[0][0]
    expect(data.receiptNsecRetiredCiphertext).toBe(stale)
    expect(data.receiptPubkeyRetired).toBe('a'.repeat(64))
    expect(data.receiptSignerReplacedAt).toBeInstanceOf(Date)
  })

  it('replaces the signer even when nothing else proves the active secret', async () => {
    mockRow({
      nwcCiphertext: legacy(NWC_URI, 'nwc', OTHER_SECRET),
      receiptNsecCiphertext: legacy(NSEC_HEX, 'receipt-nsec', OTHER_SECRET),
      receiptPubkey: 'a'.repeat(64)
    })

    // Zaps are platform-wide, so recovery cannot be conditional on some other
    // credential happening to exist. Retention is what keeps this safe.
    await migrateProxyNwcVault()

    expect(prismaMock.proxyServiceConfig.updateMany).toHaveBeenCalledOnce()
  })

  it('derives a missing pubkey rather than replacing a readable signer', async () => {
    mockRow({
      receiptNsecCiphertext: canonical(NSEC_HEX, 'receipt-nsec'),
      receiptPubkey: null
    })

    await migrateProxyNwcVault()

    expect(prismaMock.proxyServiceConfig.update).toHaveBeenCalledWith({
      where: { id: 'default' },
      data: { receiptPubkey: 'd'.repeat(64) }
    })
    expect(prismaMock.proxyServiceConfig.updateMany).not.toHaveBeenCalled()
  })

  it('does not fail startup when the proxy NWC URI is unreadable', async () => {
    mockRow({ nwcCiphertext: legacy(NWC_URI, 'nwc', OTHER_SECRET) })

    await expect(migrateProxyNwcVault()).resolves.toBeUndefined()
  })

  it('respects a deliberately cleared signer', async () => {
    mockRow({ nwcCiphertext: canonical(NWC_URI, 'nwc') })

    await migrateProxyNwcVault()

    expect(prismaMock.proxyServiceConfig.updateMany).not.toHaveBeenCalled()
  })

  it('is a no-op without a vault secret and without a proxy row', async () => {
    mockVault(null)
    await migrateProxyNwcVault()
    expect(prismaMock.proxyServiceConfig.findUnique).not.toHaveBeenCalled()

    mockVault()
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue(
      null as never
    )
    await migrateProxyNwcVault()
    expect(prismaMock.proxyServiceConfig.update).not.toHaveBeenCalled()
  })
})
