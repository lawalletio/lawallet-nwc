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

import { POST } from '@/app/api/wallet/swaps/route'
import { GET as GetOne } from '@/app/api/wallet/swaps/[id]/route'
import { GET as Alias } from '@/app/api/wallet/alias/[query]/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'

beforeEach(() => {
  resetPrismaMock()
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
