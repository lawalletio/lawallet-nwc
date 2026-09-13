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
import { decryptProxySecret, encryptProxySecret } from '@/lib/proxy/vault'
import { closeServerNwcClient } from '@/lib/wallet/drivers/nwc-client-cache'
import { DEFAULT_PROXY_FEE_BPS, PROXY_WALLET_ID } from '@/lib/proxy/constants'

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
    // `clearAllMocks` keeps implementations, so a test that made the vault
    // throw would otherwise leak that into every test declared after it.
    vi.mocked(decryptProxySecret).mockReturnValue('old-nwc-uri')
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

  it('answers with the defaults before a proxy has ever been configured', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue(
      null as never
    )

    const body = (await assertResponse(
      await GET(createNextRequest('/api/settings/lud16-proxy')),
      200
    )) as Record<string, unknown>

    expect(body).toMatchObject({
      enabled: false,
      feeBps: DEFAULT_PROXY_FEE_BPS,
      walletId: PROXY_WALLET_ID,
      hasNwc: false,
      hasReceiptNsec: false,
      receiptPubkey: null,
      capabilities: null,
      balanceMsats: null,
      lastProbeAt: null,
      lastListenerSeenAt: null,
      lastCronAt: null,
      archivedAt: null,
      archivedReason: null
    })
  })

  it('surfaces the auto-archive so the settings tab can explain the outage', async () => {
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      ...config,
      enabled: false,
      archivedAt: new Date('2026-07-29T09:00:00Z'),
      archivedReason: 'warmup_failed'
    } as never)

    const body = (await assertResponse(
      await GET(createNextRequest('/api/settings/lud16-proxy')),
      200
    )) as Record<string, unknown>

    expect(body.archivedAt).toBe('2026-07-29T09:00:00.000Z')
    expect(body.archivedReason).toBe('warmup_failed')
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

  it('lets the operator rotate the auto-generated receipt signer', async () => {
    const nextSigner = 'b'.repeat(64)
    vi.mocked(prismaMock.proxyServiceConfig.upsert).mockResolvedValue({
      ...config,
      receiptPubkey: 'a'.repeat(64)
    } as never)

    const response = await PUT(
      createNextRequest('/api/settings/lud16-proxy', {
        method: 'PUT',
        body: { receiptNsec: nextSigner }
      })
    )

    await assertResponse(response, 200)
    expect(encryptProxySecret).toHaveBeenCalledWith(
      nextSigner,
      'default',
      'receipt-nsec'
    )
    expect(prismaMock.proxyServiceConfig.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          receiptNsecCiphertext: Uint8Array.from([1, 2, 3]),
          receiptPubkey: 'a'.repeat(64)
        })
      })
    )
  })

  it('still replaces a stored signer this deployment can no longer open', async () => {
    // Re-entering the nsec is the documented recovery after a lost
    // NWC_VAULT_SECRET, so reading the dead envelope must not 500 the write.
    vi.mocked(decryptProxySecret).mockImplementation(() => {
      throw new Error('Proxy vault decryption failed')
    })
    vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue({
      ...config,
      enabled: false
    } as never)
    vi.mocked(prismaMock.proxyServiceConfig.upsert).mockResolvedValue({
      ...config,
      enabled: false
    } as never)

    const response = await PUT(
      createNextRequest('/api/settings/lud16-proxy', {
        method: 'PUT',
        body: { receiptNsec: 'c'.repeat(64) }
      })
    )

    await assertResponse(response, 200)
    expect(encryptProxySecret).toHaveBeenCalledWith(
      'c'.repeat(64),
      'default',
      'receipt-nsec'
    )
  })

  it('asks an enabled proxy for its NWC URI too when that one is unreadable', async () => {
    // Deferred forwarding cannot run on a credential nothing can open, so
    // enabling demands both halves rather than silently half-working.
    vi.mocked(decryptProxySecret).mockImplementation(() => {
      throw new Error('Proxy vault decryption failed')
    })

    const response = await PUT(
      createNextRequest('/api/settings/lud16-proxy', {
        method: 'PUT',
        body: { receiptNsec: 'c'.repeat(64) }
      })
    )

    expect(response.status).toBe(400)
    expect(prismaMock.proxyServiceConfig.upsert).not.toHaveBeenCalled()
  })

  it('still guards an unreadable credential against mid-settlement rotation', async () => {
    vi.mocked(decryptProxySecret).mockImplementation(() => {
      throw new Error('Proxy vault decryption failed')
    })
    vi.mocked(prismaMock.proxyPayment.count).mockResolvedValue(1)

    const response = await PUT(
      createNextRequest('/api/settings/lud16-proxy', {
        method: 'PUT',
        body: { receiptNsec: 'c'.repeat(64) }
      })
    )

    expect(response.status).toBe(409)
    expect(prismaMock.proxyServiceConfig.upsert).not.toHaveBeenCalled()
  })

  // The listener archives the proxy's NWC wallet after 48h of silence, which
  // flips `enabled` off and stamps `archivedAt`. Only an operator answering
  // that — re-enabling, or supplying a different credential — clears it. An
  // unrelated edit must leave the archive standing, or the settings tab loses
  // the only explanation it has for why intake stopped.
  describe('answering the auto-archive', () => {
    const archived = {
      ...config,
      enabled: false,
      archivedAt: new Date('2026-07-29T09:00:00Z'),
      archivedReason: 'warmup_failed'
    }

    function lastUpsertUpdate(): Record<string, unknown> {
      const call = vi
        .mocked(prismaMock.proxyServiceConfig.upsert)
        .mock.calls.at(-1)
      return (call?.[0] as unknown as { update: Record<string, unknown> })
        .update
    }

    beforeEach(() => {
      vi.mocked(prismaMock.proxyServiceConfig.findUnique).mockResolvedValue(
        archived as never
      )
      vi.mocked(prismaMock.proxyServiceConfig.upsert).mockResolvedValue(
        archived as never
      )
    })

    it('clears the archive when the operator re-enables the proxy', async () => {
      await assertResponse(
        await PUT(
          createNextRequest('/api/settings/lud16-proxy', {
            method: 'PUT',
            body: { enabled: true }
          })
        ),
        200
      )

      expect(lastUpsertUpdate()).toMatchObject({
        enabled: true,
        archivedAt: null,
        archivedReason: null
      })
    })

    it('clears the archive when a fresh NWC URI arrives, still disabled', async () => {
      // Replacing a dead wallet is an answer too: the operator gets the
      // credential in first and enables afterwards, once it is verified.
      await assertResponse(
        await PUT(
          createNextRequest('/api/settings/lud16-proxy', {
            method: 'PUT',
            body: { nwcUri: 'nostr+walletconnect://fresh' }
          })
        ),
        200
      )

      const update = lastUpsertUpdate()
      expect(update).toMatchObject({ archivedAt: null, archivedReason: null })
      expect(update).not.toHaveProperty('enabled')
      // The replaced credential's pooled client is dropped.
      expect(closeServerNwcClient).toHaveBeenCalledWith('old-nwc-uri')
    })

    it('leaves the archive alone when the same NWC URI is re-saved', async () => {
      // Re-submitting the settings form without touching the field is not an
      // answer — the wallet is still the dead one.
      await assertResponse(
        await PUT(
          createNextRequest('/api/settings/lud16-proxy', {
            method: 'PUT',
            body: { nwcUri: 'old-nwc-uri' }
          })
        ),
        200
      )

      const update = lastUpsertUpdate()
      expect(update).not.toHaveProperty('archivedAt')
      expect(update).not.toHaveProperty('archivedReason')
      expect(closeServerNwcClient).not.toHaveBeenCalled()
    })

    it('leaves the archive alone on a fee-only edit', async () => {
      await assertResponse(
        await PUT(
          createNextRequest('/api/settings/lud16-proxy', {
            method: 'PUT',
            body: { feeBps: 25 }
          })
        ),
        200
      )

      const update = lastUpsertUpdate()
      expect(update).toMatchObject({ feeBps: 25 })
      expect(update).not.toHaveProperty('archivedAt')
      expect(update).not.toHaveProperty('archivedReason')
    })
  })
})
