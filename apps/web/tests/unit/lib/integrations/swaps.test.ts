// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ isTest: true, isDevelopment: false }))
}))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() })
}))
const emit = vi.hoisted(() => vi.fn())
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit } }))
vi.mock('@/lib/integrations/server', () => ({
  getIntegrationConfig: vi.fn()
}))
const provider = vi.hoisted(() => ({
  quote: vi.fn(),
  createSell: vi.fn(),
  status: vi.fn(),
  test: vi.fn()
}))
vi.mock('@/lib/integrations/bullbitcoin', () => ({
  bullBitcoinProvider: vi.fn(() => provider)
}))
vi.mock('@/lib/integrations/wapu', () => ({
  wapuProvider: vi.fn(() => provider)
}))
vi.mock('@/lib/invoice-utils', () => ({
  extractAmountSats: vi.fn(),
  extractPaymentHash: vi.fn(),
  extractExpiry: vi.fn(() => new Date('2026-11-13T16:00:00Z'))
}))

import { createHash } from 'node:crypto'
import {
  cancelSwap,
  createSwap,
  listSwapsPage,
  markSwapPaid,
  quoteSwaps,
  reconcilePendingSwaps,
  refreshSwap
} from '@/lib/integrations/swaps'
import { getIntegrationConfig } from '@/lib/integrations/server'
import { extractAmountSats, extractPaymentHash } from '@/lib/invoice-utils'

const on = {
  enabled: true,
  configured: true,
  values: { wapu_api_key: 'k', bullbitcoin_api_key: 'k' }
}
const off = { enabled: false, configured: true, values: {} }
const input = {
  provider: 'wapu' as const,
  amountArs: 20_000,
  destination: 'mi.alias.mp',
  holderName: 'Ana'
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  provider.quote.mockResolvedValue({
    sats: 10_000,
    arsPerBtc: 2e8,
    minArs: null
  })
  provider.createSell.mockResolvedValue({
    externalId: 'w1',
    bolt11: 'lnbc-invoice',
    amountSats: 0,
    providerStatus: 'Pending',
    expiresAt: null
  })
  vi.mocked(prismaMock.swap.create).mockImplementation((async ({
    data
  }: any) => ({ id: 's1', ...data })) as any)
})

describe('createSwap', () => {
  it('404s when the provider integration is off', async () => {
    vi.mocked(getIntegrationConfig).mockResolvedValue(off as any)
    await expect(createSwap('user-1', input)).rejects.toMatchObject({
      statusCode: 404
    })
    expect(provider.createSell).not.toHaveBeenCalled()
  })

  it('stores the invoice amount, not the provider-reported one', async () => {
    vi.mocked(getIntegrationConfig).mockResolvedValue(on as any)
    vi.mocked(extractAmountSats).mockReturnValue(10_100)
    await createSwap('user-1', input)
    expect(prismaMock.swap.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        provider: 'wapu',
        externalId: 'w1',
        amountSats: 10_100,
        bolt11: 'lnbc-invoice'
      })
    })
  })

  it('refuses an invoice that drifted more than 3% from the quote', async () => {
    vi.mocked(getIntegrationConfig).mockResolvedValue(on as any)
    vi.mocked(extractAmountSats).mockReturnValue(10_400)
    await expect(createSwap('user-1', input)).rejects.toMatchObject({
      statusCode: 503
    })
    expect(prismaMock.swap.create).not.toHaveBeenCalled()
  })

  it('refuses an undecodable invoice', async () => {
    vi.mocked(getIntegrationConfig).mockResolvedValue(on as any)
    vi.mocked(extractAmountSats).mockReturnValue(null)
    await expect(createSwap('user-1', input)).rejects.toMatchObject({
      statusCode: 503
    })
  })
})

describe('quoteSwaps', () => {
  it('quotes only enabled providers and isolates failures', async () => {
    vi.mocked(getIntegrationConfig).mockImplementation(
      async id => (id === 'wapu' ? on : off) as any
    )
    provider.quote.mockRejectedValueOnce(new Error('down'))
    expect(await quoteSwaps(20_000)).toEqual([
      {
        provider: 'wapu',
        sats: null,
        arsPerBtc: null,
        minArs: null,
        error: 'down'
      }
    ])
  })
})

describe('refreshSwap', () => {
  const swap = {
    id: 's1',
    provider: 'wapu',
    externalId: 'dep',
    amountArs: 20_000,
    status: 'PENDING',
    receiptUrl: null,
    providerStatus: 'Pending',
    createdAt: new Date(),
    updatedAt: new Date(Date.now() - 60_000)
  } as any

  it('skips terminal and recently refreshed swaps', async () => {
    expect(await refreshSwap({ ...swap, status: 'COMPLETED' })).toMatchObject({
      status: 'COMPLETED'
    })
    expect(await refreshSwap({ ...swap, updatedAt: new Date() })).toMatchObject(
      { id: 's1' }
    )
    expect(provider.status).not.toHaveBeenCalled()
  })

  it('persists the provider status and the matched transfer id', async () => {
    vi.mocked(getIntegrationConfig).mockResolvedValue(on as any)
    provider.status.mockResolvedValue({
      status: 'COMPLETED',
      providerStatus: 'Completed',
      externalId: 'fiat-1',
      receiptUrl: 'https://r'
    })
    vi.mocked(prismaMock.swap.update).mockResolvedValue({} as any)
    await refreshSwap(swap)
    expect(prismaMock.swap.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: {
        status: 'COMPLETED',
        providerStatus: 'Completed',
        externalId: 'fiat-1',
        receiptUrl: 'https://r',
        paidAt: null,
        expiresAt: null
      }
    })
  })
  it('records payment the provider saw and keeps the earlier deadline', async () => {
    vi.mocked(getIntegrationConfig).mockResolvedValue(on as any)
    const sooner = new Date(Date.now() + 60_000)
    provider.status.mockResolvedValue({
      status: 'PENDING',
      providerStatus: 'Sats received',
      paid: true,
      expiresAt: sooner
    })
    vi.mocked(prismaMock.swap.update).mockResolvedValue({} as any)
    await refreshSwap({
      ...swap,
      paidAt: null,
      expiresAt: new Date(Date.now() + 86_400_000)
    })
    expect(prismaMock.swap.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          paidAt: expect.any(Date),
          expiresAt: sooner
        })
      })
    )
  })

  it('expires an unpaid order whose invoice lapsed', async () => {
    vi.mocked(getIntegrationConfig).mockResolvedValue(on as any)
    provider.status.mockResolvedValue({
      status: 'PENDING',
      providerStatus: 'Awaiting transfer'
    })
    vi.mocked(prismaMock.swap.update).mockResolvedValue({} as any)
    const lapsed = {
      ...swap,
      paidAt: null,
      expiresAt: new Date(Date.now() - 1)
    }
    await refreshSwap(lapsed)
    expect(prismaMock.swap.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'EXPIRED' })
      })
    )
    // Paid orders keep waiting on the provider, even past the invoice expiry.
    await refreshSwap({ ...lapsed, paidAt: new Date() })
    expect(prismaMock.swap.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING' })
      })
    )
  })
})

describe('markSwapPaid', () => {
  const preimage = 'ab'.repeat(32)
  const hash = createHash('sha256')
    .update(Buffer.from(preimage, 'hex'))
    .digest('hex')
  const swap = { id: 's1', bolt11: 'lnbc', paidAt: null } as any

  it('records payment when sha256(preimage) is the invoice hash', async () => {
    vi.mocked(extractPaymentHash).mockReturnValue(hash)
    vi.mocked(prismaMock.swap.update).mockResolvedValue({} as any)
    await markSwapPaid(swap, preimage)
    expect(prismaMock.swap.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { paidAt: expect.any(Date) }
    })
  })

  it('rejects a preimage for another invoice', async () => {
    vi.mocked(extractPaymentHash).mockReturnValue('00'.repeat(32))
    await expect(markSwapPaid(swap, preimage)).rejects.toMatchObject({
      statusCode: 400
    })
    expect(prismaMock.swap.update).not.toHaveBeenCalled()
  })

  it('revives an expired or canceled order when a valid preimage arrives', async () => {
    vi.mocked(extractPaymentHash).mockReturnValue(hash)
    vi.mocked(prismaMock.swap.update).mockResolvedValue({} as any)
    await markSwapPaid({ ...swap, status: 'CANCELED' }, preimage)
    expect(prismaMock.swap.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { paidAt: expect.any(Date), status: 'PENDING' }
    })
  })

  it('is idempotent once paid', async () => {
    const paid = { ...swap, paidAt: new Date() }
    expect(await markSwapPaid(paid, preimage)).toBe(paid)
    expect(prismaMock.swap.update).not.toHaveBeenCalled()
  })
})

describe('cancelSwap', () => {
  const swap = {
    id: 's1',
    userId: 'u1',
    provider: 'wapu',
    externalId: 'dep',
    amountArs: 20_000,
    status: 'PENDING',
    paidAt: null,
    receiptUrl: null,
    providerStatus: 'Awaiting transfer',
    expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
    updatedAt: new Date()
  } as any

  beforeEach(() => {
    vi.mocked(getIntegrationConfig).mockResolvedValue(on as any)
    vi.mocked(prismaMock.swap.update).mockImplementation((async ({
      data
    }: any) => ({ ...swap, ...data })) as any)
  })

  it('cancels an unpaid order the provider still has open', async () => {
    provider.status.mockResolvedValue({
      status: 'PENDING',
      providerStatus: 'Awaiting transfer'
    })
    const out = await cancelSwap(swap)
    // Asked the provider despite a fresh updatedAt (no throttle on cancel).
    expect(provider.status).toHaveBeenCalled()
    expect(out.status).toBe('CANCELED')
  })

  it('refuses once the provider has settled it', async () => {
    provider.status.mockResolvedValue({
      status: 'COMPLETED',
      providerStatus: 'Completed'
    })
    await expect(cancelSwap(swap)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('refuses a paid order without asking the provider', async () => {
    await expect(
      cancelSwap({ ...swap, paidAt: new Date() })
    ).rejects.toMatchObject({ statusCode: 409 })
    expect(provider.status).not.toHaveBeenCalled()
  })

  it('is idempotent', async () => {
    const canceled = { ...swap, status: 'CANCELED' }
    expect(await cancelSwap(canceled)).toBe(canceled)
  })
})

describe('live updates', () => {
  const pending = {
    id: 's1',
    userId: 'user-1',
    provider: 'wapu',
    externalId: 'dep',
    amountArs: 20_000,
    status: 'PENDING',
    receiptUrl: null,
    providerStatus: 'Pending',
    createdAt: new Date(),
    updatedAt: new Date(Date.now() - 60_000)
  } as any

  it('emits swaps:updated to the owner when the provider status moves', async () => {
    vi.mocked(getIntegrationConfig).mockResolvedValue(on as any)
    provider.status.mockResolvedValue({
      status: 'COMPLETED',
      providerStatus: 'Completed'
    })
    vi.mocked(prismaMock.swap.update).mockResolvedValue({
      ...pending,
      status: 'COMPLETED',
      providerStatus: 'Completed'
    } as any)
    await refreshSwap(pending)
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'swaps:updated', userId: 'user-1' })
    )
  })

  it('stays quiet when nothing changed', async () => {
    vi.mocked(getIntegrationConfig).mockResolvedValue(on as any)
    provider.status.mockResolvedValue({
      status: 'PENDING',
      providerStatus: 'Pending'
    })
    vi.mocked(prismaMock.swap.update).mockResolvedValue(pending)
    await refreshSwap(pending)
    expect(emit).not.toHaveBeenCalled()
  })

  it('reconciles only recent pending swaps that are paid or not long expired', async () => {
    vi.mocked(prismaMock.swap.findMany).mockResolvedValue([])
    await reconcilePendingSwaps()
    const where = (vi.mocked(prismaMock.swap.findMany).mock.calls[0][0] as any)
      .where
    expect(where.status).toBe('PENDING')
    expect(where.OR).toEqual([
      { paidAt: { not: null } },
      { expiresAt: { gte: expect.any(Date) } }
    ])
  })
})

describe('listSwapsPage', () => {
  it('pages newest-first and reports the total', async () => {
    vi.mocked(prismaMock.swap.findMany).mockResolvedValue([])
    vi.mocked(prismaMock.swap.count).mockResolvedValue(23)
    const res = await listSwapsPage('user-1', 3, 10)
    expect(prismaMock.swap.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      skip: 20,
      take: 10
    })
    expect(res).toEqual({ items: [], total: 23, page: 3, pageSize: 10 })
  })
})
