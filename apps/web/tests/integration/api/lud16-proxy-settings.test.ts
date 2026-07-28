import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1_048_576, maxJsonSize: 1_048_576 },
    nwcVault: { enabled: true, secret: 'secret' }
  }))
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))
vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/settings-auth', () => ({
  authenticateSettingsReadRequest: vi.fn(),
  authenticateSettingsWriteRequest: vi.fn()
}))
vi.mock('@/lib/listener-config', () => ({
  getListenerConfig: vi.fn(async () => ({
    enabled: true,
    url: 'http://listener',
    secret: 'secret'
  }))
}))
vi.mock('@/lib/proxy/vault', () => ({
  isProxyVaultConfigured: vi.fn(() => true),
  decryptProxySecret: vi.fn(() => 'old-nwc-uri'),
  encryptProxySecret: vi.fn(() => Uint8Array.from([1, 2, 3]))
}))
vi.mock('@/lib/proxy/nostr', () => ({
  normalizeNostrPrivateKey: vi.fn((value: string) => value),
  receiptPubkey: vi.fn(() => 'a'.repeat(64))
}))
vi.mock('@/lib/wallet/drivers', () => ({
  driverForWallet: vi.fn(() => ({ driver: {}, config: {} }))
}))
vi.mock('@/lib/wallet/drivers/nwc-client-cache', () => ({
  closeServerNwcClient: vi.fn()
}))

import { GET, PUT } from '@/app/api/settings/lud16-proxy/route'

const config = {
  id: 'default',
  enabled: true,
  feeBps: 50,
  walletId: '__lawallet_proxy__',
  nwcCiphertext: Uint8Array.from([1]),
  receiptNsecCiphertext: Uint8Array.from([2]),
  receiptPubkey: 'a'.repeat(64),
  capabilities: { methods: ['make_invoice'] },
  balanceMsats: BigInt(123_000),
  lastProbeAt: new Date('2026-07-27T12:00:00Z'),
  lastProbeError: null,
  lastListenerSeenAt: new Date('2026-07-27T12:00:00Z'),
  lastCronAt: new Date('2026-07-27T12:00:00Z'),
  createdAt: new Date(),
  updatedAt: new Date()
}

describe('admin LUD-16 proxy settings', () => {
  beforeEach(() => {
    resetPrismaMock()
    vi.clearAllMocks()
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue(
      config as never
    )
    vi.mocked(prismaMock.proxyPayment.count).mockResolvedValue(0)
    vi.mocked(prismaMock.proxyInvoiceIntent.count).mockResolvedValue(0)
  })

  it('returns write-only secret state without exposing either credential', async () => {
    const body = (await assertResponse(
      await GET(createNextRequest('/api/settings/lud16-proxy')),
      200
    )) as Record<string, unknown>

    expect(body.hasNwc).toBe(true)
    expect(body.hasReceiptNsec).toBe(true)
    expect(body.balanceMsats).toBe('123000')
    expect(body).not.toHaveProperty('nwcUri')
    expect(body).not.toHaveProperty('receiptNsec')
    expect(JSON.stringify(body)).not.toContain('old-nwc-uri')
  })

  it('blocks proxy NWC rotation while a settlement is outstanding', async () => {
    vi.mocked(prismaMock.proxyPayment.count).mockResolvedValue(1)

    const response = await PUT(
      createNextRequest('/api/settings/lud16-proxy', {
        method: 'PUT',
        body: { nwcUri: 'nostr+walletconnect://new' }
      })
    )

    expect(response.status).toBe(409)
    expect(prismaMock.proxyServiceConfig.upsert).not.toHaveBeenCalled()
  })
})
