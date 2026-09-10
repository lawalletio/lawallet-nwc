import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

/**
 * NIP-57 has two halves that must agree: what a Lightning Address promises a
 * payer (`allowsNostr` / the `nip57` protocol chip) and whether anything is
 * actually driving those invoices to settlement so a receipt gets published.
 *
 * Advertising without the sweep is the original bug — a zap is paid and never
 * receipted. Sweeping without advertising is wasted relay traffic. Both read
 * `getZapReceiptCapability()`, and these tests exist to keep it that way.
 */

const capability = vi.hoisted(() => ({ nip57: true }))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

vi.mock('@/lib/nostr/zap-receipts', () => ({
  getZapReceiptCapability: vi.fn(async () => ({
    lud21: true,
    nip57: capability.nip57,
    receiptPubkey: capability.nip57 ? 'b'.repeat(64) : null,
    reason: capability.nip57
      ? null
      : 'NIP-57 requires the NWC listener to detect settlement.'
  }))
}))

vi.mock('@/lib/proxy/config', () => ({ getActiveProxyConfig: vi.fn() }))
vi.mock('@/lib/listener-config', () => ({ getListenerConfig: vi.fn() }))
vi.mock('@/lib/invoices/settle-from-wallet', () => ({
  settleInvoiceFromWallet: vi.fn(async () => ({
    outcome: 'settled',
    preimage: 'c'.repeat(64),
    paidAt: new Date()
  }))
}))

import { settlePendingZapInvoices } from '@/lib/nostr/zap-settlement'
import { resolveAddressProtocols } from '@/lib/wallet/address-protocols'
import { getActiveProxyConfig } from '@/lib/proxy/config'
import { getListenerConfig } from '@/lib/listener-config'

const user = {
  id: 'user-1',
  pubkey: 'ab'.repeat(32),
  nostrIdentities: [{ pubkey: 'ab'.repeat(32) }]
}

/** An address served by this instance through its bound NWC wallet. */
const walletAddress = {
  mode: 'CUSTOM_NWC',
  redirect: null,
  aliasProtocols: null,
  routable: true,
  user
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  capability.nip57 = true
  vi.mocked(getActiveProxyConfig).mockResolvedValue(null as never)
  vi.mocked(getListenerConfig).mockResolvedValue({ enabled: true } as never)
  vi.mocked(prismaMock.invoice.findMany).mockResolvedValue([
    {
      id: 'invoice-1',
      paymentHash: 'a'.repeat(64),
      status: 'PENDING',
      zapRequest: { kind: 9734 },
      zapRequestJson: '{"kind":9734}',
      settlementPollAttempts: 0,
      settlementNextPollAt: null,
      remoteWallet: {
        id: 'wallet-1',
        type: 'NWC',
        status: 'ACTIVE',
        config: { connectionString: 'nostr+walletconnect://x' }
      },
      proxyPayment: null
    }
  ] as never)
  vi.mocked(prismaMock.invoice.updateMany).mockResolvedValue({
    count: 1
  } as never)
})

describe('NIP-57 availability', () => {
  it('sweeps settlement for the same addresses that advertise NIP-57', async () => {
    const [protocols, settled] = await Promise.all([
      resolveAddressProtocols(walletAddress),
      settlePendingZapInvoices()
    ])

    // Promised to payers…
    expect(protocols.protocols.nip57).toBe(true)
    // …and backed by a sweep that can deliver the receipt.
    expect(settled).toBe(1)
  })

  it('stops advertising NIP-57 when nothing can settle the invoice', async () => {
    capability.nip57 = false

    const [protocols, settled] = await Promise.all([
      resolveAddressProtocols(walletAddress),
      settlePendingZapInvoices()
    ])

    expect(protocols.protocols.nip57).toBe(false)
    expect(settled).toBe(0)
    // LUD-21 verify still works: the payer can poll it, which settles through
    // the same helper. Only the receipt publication needs the listener.
    expect(protocols.protocols.lud21).toBe(true)
    expect(protocols.reason).toMatch(/listener/i)
  })

  it('never sweeps an address whose wallet cannot receive at all', async () => {
    const protocols = await resolveAddressProtocols({
      ...walletAddress,
      routable: false
    })

    // An inactive wallet mints nothing, so there is no pending zap invoice to
    // find — the advertisement has to be off too, or we promise a receipt for
    // a payment that can never be taken.
    expect(protocols.protocols.nip57).toBe(false)
    expect(protocols.protocols.lud16).toBe(false)
  })
})
