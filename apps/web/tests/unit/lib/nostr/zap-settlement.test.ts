import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const capability = vi.hoisted(() => ({ nip57: true }))
const settleMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

vi.mock('@/lib/nostr/zap-receipts', () => ({
  getZapReceiptCapability: vi.fn(async () => ({
    lud21: true,
    nip57: capability.nip57,
    receiptPubkey: capability.nip57 ? 'b'.repeat(64) : null,
    reason: capability.nip57 ? null : 'NIP-57 requires the NWC listener.'
  }))
}))

vi.mock('@/lib/invoices/settle-from-wallet', () => ({
  settleInvoiceFromWallet: settleMock
}))

import {
  nextPollDelayMs,
  settlePendingZapInvoices
} from '@/lib/nostr/zap-settlement'
import { getZapReceiptCapability } from '@/lib/nostr/zap-receipts'

function dueInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    paymentHash: 'a'.repeat(64),
    bolt11: 'lnbc100n1zap',
    amountSats: 21,
    status: 'PENDING',
    preimage: null,
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
    proxyPayment: null,
    ...overrides
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  capability.nip57 = true
  settleMock.mockResolvedValue({
    outcome: 'settled',
    preimage: 'c'.repeat(64),
    paidAt: new Date()
  })
  vi.mocked(prismaMock.invoice.updateMany).mockResolvedValue({
    count: 1
  } as never)
})

describe('settlePendingZapInvoices', () => {
  it('does nothing while NIP-57 is unavailable', async () => {
    capability.nip57 = false

    await expect(settlePendingZapInvoices()).resolves.toBe(0)

    // Cheapest possible check first: no query, no relay traffic, no claims.
    expect(prismaMock.invoice.findMany).not.toHaveBeenCalled()
    expect(settleMock).not.toHaveBeenCalled()
  })

  it('polls only unexpired, wallet-backed, non-proxy zap invoices', async () => {
    vi.mocked(prismaMock.invoice.findMany).mockResolvedValue([] as never)

    await settlePendingZapInvoices()

    expect(getZapReceiptCapability).toHaveBeenCalled()
    const where = vi.mocked(prismaMock.invoice.findMany).mock.calls[0][0]
      ?.where as Record<string, unknown>
    expect(where).toMatchObject({
      status: 'PENDING',
      zapRequestJson: { not: null },
      // The proxy pipeline owns its own settlement + forwarding state machine.
      proxyPayment: null,
      // Without the minting wallet there's nothing safe to ask.
      remoteWalletId: { not: null }
    })
    expect(where.expiresAt).toEqual({ gt: expect.any(Date) })
    expect(where.OR).toEqual([
      { settlementNextPollAt: null },
      { settlementNextPollAt: { lte: expect.any(Date) } }
    ])
  })

  it('settles a paid invoice and counts it', async () => {
    const invoice = dueInvoice()
    vi.mocked(prismaMock.invoice.findMany).mockResolvedValue([invoice] as never)

    await expect(settlePendingZapInvoices()).resolves.toBe(1)

    expect(settleMock).toHaveBeenCalledWith(
      invoice,
      expect.objectContaining({ source: 'zap_settlement_sweep' })
    )
    // No `schedule`, so the receipt publish is awaited inside the helper rather
    // than handed to `after()` — nothing would run it in a background sweep.
    expect(settleMock.mock.calls[0][1].schedule).toBeUndefined()
  })

  it('does not count an invoice the wallet still reports unpaid', async () => {
    vi.mocked(prismaMock.invoice.findMany).mockResolvedValue([
      dueInvoice()
    ] as never)
    settleMock.mockResolvedValue({ outcome: 'pending' })

    await expect(settlePendingZapInvoices()).resolves.toBe(0)
  })

  it('claims each invoice by pushing its next poll forward', async () => {
    vi.mocked(prismaMock.invoice.findMany).mockResolvedValue([
      dueInvoice({ settlementPollAttempts: 3 })
    ] as never)

    await settlePendingZapInvoices()

    const claim = vi.mocked(prismaMock.invoice.updateMany).mock
      .calls[0][0] as any
    // The claim re-checks the same due predicate it read on: Postgres
    // re-evaluates it under the row lock, so only one sweep can win.
    expect(claim.where).toMatchObject({ id: 'invoice-1', status: 'PENDING' })
    expect(claim.where.OR).toEqual([
      { settlementNextPollAt: null },
      { settlementNextPollAt: { lte: expect.any(Date) } }
    ])
    expect(claim.data.settlementPollAttempts).toEqual({ increment: 1 })
    expect(claim.data.settlementNextPollAt).toBeInstanceOf(Date)
  })

  it('skips an invoice another sweep already claimed', async () => {
    vi.mocked(prismaMock.invoice.findMany).mockResolvedValue([
      dueInvoice()
    ] as never)
    vi.mocked(prismaMock.invoice.updateMany).mockResolvedValue({
      count: 0
    } as never)

    await expect(settlePendingZapInvoices()).resolves.toBe(0)

    // Losing the claim must not double the relay traffic for one invoice.
    expect(settleMock).not.toHaveBeenCalled()
  })

  it('keeps polling the rest of the batch when one invoice fails', async () => {
    vi.mocked(prismaMock.invoice.findMany).mockResolvedValue([
      dueInvoice({ id: 'invoice-1' }),
      dueInvoice({ id: 'invoice-2' })
    ] as never)
    settleMock
      .mockResolvedValueOnce({ outcome: 'unavailable' })
      .mockResolvedValueOnce({
        outcome: 'settled',
        preimage: 'c'.repeat(64),
        paidAt: new Date()
      })

    await expect(settlePendingZapInvoices()).resolves.toBe(1)
    expect(settleMock).toHaveBeenCalledTimes(2)
  })
})

describe('nextPollDelayMs', () => {
  it('polls tightly at first, then backs off as the odds drop', () => {
    // A zap is normally paid within seconds, so the first minute is cheap and
    // fast; a long-unpaid invoice trickles until it expires.
    expect(nextPollDelayMs(0)).toBe(15_000)
    expect(nextPollDelayMs(4)).toBe(15_000)
    expect(nextPollDelayMs(5)).toBe(60_000)
    expect(nextPollDelayMs(11)).toBe(60_000)
    expect(nextPollDelayMs(12)).toBe(300_000)
    expect(nextPollDelayMs(500)).toBe(300_000)
  })

  it('never returns a non-positive delay (which would spin the sweep)', () => {
    for (const attempts of [0, 1, 7, 20, 1_000]) {
      expect(nextPollDelayMs(attempts)).toBeGreaterThan(0)
    }
  })
})
