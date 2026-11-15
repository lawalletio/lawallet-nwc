// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 }
  }))
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }),
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: vi.fn(() => undefined)
}))
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { sensitive: {}, auth: {} }
}))
vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))
vi.mock('@/lib/auth/account', () => ({ resolveAccountByPubkey: vi.fn() }))
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {},
  logActivity: { fireAndForget: vi.fn() }
}))
vi.mock('@/lib/integrations/server', () => ({
  getIntegrationConfig: vi.fn(async () => ({
    enabled: false,
    configured: false,
    values: {}
  }))
}))

vi.mock('@/lib/integrations/bullbitcoin', async importActual => ({
  ...(await importActual<object>()),
  getBullOrderSummary: vi.fn()
}))
vi.mock('@/lib/integrations/alias', async importActual => ({
  ...(await importActual<object>()),
  lookupAlias: vi.fn()
}))

import { POST } from '@/app/api/wallet/swaps/route'
import { GET as GetOne } from '@/app/api/wallet/swaps/[id]/route'
import { GET as Alias } from '@/app/api/wallet/alias/[query]/route'
import { GET as Receipt } from '@/app/api/wallet/swaps/[id]/receipt/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { getIntegrationConfig } from '@/lib/integrations/server'
import { getBullOrderSummary } from '@/lib/integrations/bullbitcoin'
import { lookupAlias } from '@/lib/integrations/alias'

beforeEach(() => {
  resetPrismaMock()
  vi.mocked(getIntegrationConfig).mockResolvedValue({
    enabled: false,
    configured: false,
    values: {}
  } as any)
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: 'a'.repeat(64),
    role: 'USER',
    method: 'jwt'
  } as any)
  vi.mocked(resolveAccountByPubkey).mockResolvedValue({ id: 'user-1' } as any)
})

describe('POST /api/wallet/swaps', () => {
  it('404s when the provider is not enabled', async () => {
    const res = await POST(
      createNextRequest('http://localhost:3000/api/wallet/swaps', {
        method: 'POST',
        body: { provider: 'wapu', amountArs: 20000, destination: 'mi.alias.mp' }
      })
    )
    expect(res.status).toBe(404)
    expect(prismaMock.swap.create).not.toHaveBeenCalled()
  })

  it('validates the bank destination', async () => {
    const res = await POST(
      createNextRequest('http://localhost:3000/api/wallet/swaps', {
        method: 'POST',
        body: { provider: 'wapu', amountArs: 20000, destination: 'no' }
      })
    )
    expect(res.status).toBe(400)
  })
})

describe('GET /api/wallet/swaps/[id]', () => {
  it('scopes the lookup to the caller and hides other users’ swaps', async () => {
    vi.mocked(prismaMock.swap.findFirst).mockResolvedValue(null)
    const res = await GetOne(
      createNextRequest('http://localhost:3000/api/wallet/swaps/s1'),
      createParamsPromise({ id: 's1' })
    )
    expect(res.status).toBe(404)
    expect(prismaMock.swap.findFirst).toHaveBeenCalledWith({
      where: { id: 's1', userId: 'user-1' }
    })
  })
})

describe('GET /api/wallet/alias/[query]', () => {
  it('404s when the alias integration is off', async () => {
    const res = await Alias(
      createNextRequest('http://localhost:3000/api/wallet/alias/mi.alias.mp'),
      createParamsPromise({ query: 'mi.alias.mp' })
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/wallet/swaps/[id]/receipt', () => {
  const bull = {
    id: 's1',
    userId: 'user-1',
    provider: 'bullbitcoin',
    externalId: 'bb-1',
    destination: '0000003100010000000001',
    holderName: 'Ana',
    amountArs: 50000,
    amountSats: 44567,
    bolt11: 'lnbc-invalid',
    status: 'COMPLETED',
    paidAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  }
  const get = () =>
    Receipt(
      createNextRequest('http://localhost:3000/api/wallet/swaps/s1/receipt'),
      createParamsPromise({ id: 's1' })
    )

  it('returns a PDF for the owner’s completed Bull Bitcoin swap', async () => {
    vi.mocked(prismaMock.swap.findFirst).mockResolvedValue(bull as any)
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain(
      'comprobante-bullbitcoin-bb-1.pdf'
    )
    expect(prismaMock.swap.findFirst).toHaveBeenCalledWith({
      where: { id: 's1', userId: 'user-1' }
    })
  })

  it('409s until the transfer completes and 404s for other providers', async () => {
    vi.mocked(prismaMock.swap.findFirst).mockResolvedValue({
      ...bull,
      status: 'PENDING'
    } as any)
    expect((await get()).status).toBe(409)
    vi.mocked(prismaMock.swap.findFirst).mockResolvedValue({
      ...bull,
      provider: 'wapu'
    } as any)
    expect((await get()).status).toBe(404)
  })

  it('uses Bull Bitcoin’s live order and the alias lookup for the shareable receipt', async () => {
    vi.mocked(prismaMock.swap.findFirst).mockResolvedValue(bull as any)
    vi.mocked(getIntegrationConfig).mockResolvedValue({
      enabled: true,
      configured: true,
      values: { bullbitcoin_api_key: 'k', alias_api_url: 'https://alias' }
    } as any)
    vi.mocked(getBullOrderSummary).mockResolvedValue({
      orderNumber: 12345,
      completedAt: '2026-11-14T12:00:00Z'
    })
    vi.mocked(lookupAlias).mockResolvedValue({
      cvu: bull.destination,
      alias: 'ana.mp',
      bank: 'Mercado Pago',
      owners: [{ name: 'Ana', cuit: '20-1-1' }]
    } as any)
    const res = await Receipt(
      createNextRequest(
        'http://localhost:3000/api/wallet/swaps/s1/receipt?variant=share'
      ),
      createParamsPromise({ id: 's1' })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain(
      'filename="comprobante-12345.pdf"'
    )
    expect(getBullOrderSummary).toHaveBeenCalledWith('k', 'bb-1')
    expect(lookupAlias).toHaveBeenCalledWith('https://alias', bull.destination)
  })

  it('still issues the receipt when Bull Bitcoin is unreachable', async () => {
    vi.mocked(prismaMock.swap.findFirst).mockResolvedValue(bull as any)
    vi.mocked(getIntegrationConfig).mockResolvedValue({
      enabled: true,
      configured: true,
      values: { bullbitcoin_api_key: 'k', alias_api_url: 'https://alias' }
    } as any)
    vi.mocked(getBullOrderSummary).mockRejectedValue(new Error('down'))
    vi.mocked(lookupAlias).mockRejectedValue(new Error('down'))
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain(
      'comprobante-bullbitcoin-bb-1.pdf'
    )
  })
})
