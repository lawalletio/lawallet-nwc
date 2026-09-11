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
import { decryptProxySecret } from '@/lib/proxy/vault'
import { encryptNwcVaultEnvelope } from '@/lib/wallet/remote-wallet-vault-core'

const ACTIVE_SECRET =
  'active-proxy-vault-secret-0123456789abcdef0123456789abcdef'
const FOREIGN_SECRET =
  'foreign-proxy-vault-secret-0123456789abcdef0123456789abcdef'
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
}) {
  vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
    id: 'default',
    nwcCiphertext: row.nwcCiphertext ?? null,
    receiptNsecCiphertext: row.receiptNsecCiphertext ?? null
  } as never)
}

function writtenField(
  call: number,
  column: 'nwcCiphertext' | 'receiptNsecCiphertext'
): Uint8Array {
  return vi.mocked(prismaMock.proxyServiceConfig.update).mock.calls[call][0]
    .data[column] as Uint8Array
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  mockVault()
})

describe('ProxyServiceConfig NWC vault convergence', () => {
  it('converts a legacy LWPX01 NWC blob to the canonical envelope', async () => {
    mockRow({ nwcCiphertext: legacy(NWC_URI, 'nwc') })

    await migrateProxyNwcVault()

    const written = writtenField(0, 'nwcCiphertext')
    expect(Buffer.from(written).toString('utf8').startsWith('lwrw1:')).toBe(
      true
    )
    expect(decryptProxySecret(written, 'default', 'nwc')).toBe(NWC_URI)
  })

  it('leaves an already canonical envelope untouched', async () => {
    mockRow({
      nwcCiphertext: canonical(NWC_URI, 'nwc'),
      receiptNsecCiphertext: canonical(NSEC_HEX, 'receipt-nsec')
    })

    await migrateProxyNwcVault()

    expect(prismaMock.proxyServiceConfig.update).not.toHaveBeenCalled()
  })

  it('leaves a credential no configured secret can open', async () => {
    mockRow({
      nwcCiphertext: legacy(NWC_URI, 'nwc', FOREIGN_SECRET),
      receiptNsecCiphertext: legacy(NSEC_HEX, 'receipt-nsec', FOREIGN_SECRET)
    })

    // Reported, not rewritten and not fatal. The signer's own repair is
    // ensureZapReceiptSigner.
    await expect(migrateProxyNwcVault()).resolves.toBeUndefined()
    expect(prismaMock.proxyServiceConfig.update).not.toHaveBeenCalled()
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
