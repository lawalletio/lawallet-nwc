import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { ConflictError, ServiceUnavailableError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))
vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { sensitive: {} }
}))
vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))
vi.mock('@/lib/auth/account', () => ({ resolveAccountByPubkey: vi.fn() }))
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: { ADDRESS_UPDATED: 'ADDRESS_UPDATED' },
  logActivity: { fireAndForget: vi.fn() }
}))
vi.mock('@/lib/silent-payments', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/silent-payments')>()),
  publishSilentPayment: vi.fn(),
  unpublishSilentPayment: vi.fn()
}))

import {
  PUT,
  DELETE
} from '@/app/api/wallet/addresses/[username]/silent-payment/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import {
  publishSilentPayment,
  unpublishSilentPayment
} from '@/lib/silent-payments'

const SP =
  'sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv'
const URL_ = 'http://localhost:3000/api/wallet/addresses/alice/silent-payment'
const params = () => createParamsPromise({ username: 'alice' })

function put(address: string) {
  return PUT(
    createNextRequest(URL_, { method: 'PUT', body: { address } }),
    params()
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: 'a'.repeat(64),
    role: 'USER' as any,
    method: 'jwt'
  })
  vi.mocked(resolveAccountByPubkey).mockResolvedValue({ id: 'user-1' } as any)
  vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
    username: 'alice',
    userId: 'user-1',
    silentPaymentAddress: null
  } as any)
})

describe('PUT /api/wallet/addresses/[username]/silent-payment', () => {
  it('publishes to DNS, then stores the address', async () => {
    const res = await put(SP)
    const data = (await assertResponse(res, 200)) as {
      silentPaymentAddress: string
    }
    expect(data.silentPaymentAddress).toBe(SP)
    expect(publishSilentPayment).toHaveBeenCalledWith('alice', SP)
    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith({
      where: { username: 'alice' },
      data: { silentPaymentAddress: SP }
    })
  })

  it('401s when the caller has no account', async () => {
    vi.mocked(resolveAccountByPubkey).mockResolvedValue(null)
    await assertResponse(await put(SP), 401)
    expect(publishSilentPayment).not.toHaveBeenCalled()
  })

  it('404s for an address the caller does not own', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      userId: 'someone-else',
      silentPaymentAddress: null
    } as any)
    await assertResponse(await put(SP), 404)
    expect(publishSilentPayment).not.toHaveBeenCalled()
  })

  it('400s on an invalid checksum without touching DNS', async () => {
    await assertResponse(await put(SP.slice(0, -1) + 'q'), 400)
    expect(publishSilentPayment).not.toHaveBeenCalled()
  })

  it('409s when the feature is disabled', async () => {
    vi.mocked(publishSilentPayment).mockRejectedValue(
      new ConflictError('Silent payments are not enabled on this server')
    )
    await assertResponse(await put(SP), 409)
    expect(prismaMock.lightningAddress.update).not.toHaveBeenCalled()
  })

  it('leaves the DB untouched when the DNS provider fails', async () => {
    vi.mocked(publishSilentPayment).mockRejectedValue(
      new ServiceUnavailableError('Cloudflare: boom')
    )
    await assertResponse(await put(SP), 503)
    expect(prismaMock.lightningAddress.update).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/wallet/addresses/[username]/silent-payment', () => {
  it('removes the record and clears the address', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue({
      username: 'alice',
      userId: 'user-1',
      silentPaymentAddress: SP
    } as any)
    const res = await DELETE(
      createNextRequest(URL_, { method: 'DELETE' }),
      params()
    )
    await assertResponse(res, 200)
    expect(unpublishSilentPayment).toHaveBeenCalledWith('alice')
    expect(prismaMock.lightningAddress.update).toHaveBeenCalledWith({
      where: { username: 'alice' },
      data: { silentPaymentAddress: null }
    })
  })

  it('is a no-op when nothing is set', async () => {
    const res = await DELETE(
      createNextRequest(URL_, { method: 'DELETE' }),
      params()
    )
    await assertResponse(res, 200)
    expect(unpublishSilentPayment).not.toHaveBeenCalled()
  })
})
