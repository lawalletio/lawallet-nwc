import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { AuthorizationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  })),
  withRequestLogging: (fn: unknown) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithRole: vi.fn()
}))

vi.mock('@/lib/wallet/verify-address-protocols', () => ({
  verifyAddressProtocols: vi.fn()
}))

import { POST } from '@/app/api/lightning-addresses/verify-protocols/route'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { verifyAddressProtocols } from '@/lib/wallet/verify-address-protocols'
import { Role } from '@/lib/auth/permissions'

const adminAuth = {
  pubkey: 'a'.repeat(64),
  role: Role.ADMIN,
  method: 'jwt' as const
}

const okResult = {
  username: 'misscons',
  mode: 'ALIAS',
  redirect: 'olivepanther6@primal.net',
  probed: true,
  persisted: true,
  error: null,
  previous: {
    protocols: {
      lud16: null,
      nip05: true,
      lud21: null,
      nip57: null,
      lud12: null
    },
    source: 'alias',
    reason: 'Use Verify Protocols to check the redirect.',
    provider: 'olivepanther6@primal.net'
  },
  protocols: {
    protocols: {
      lud16: true,
      nip05: true,
      lud21: false,
      nip57: true,
      lud12: false
    },
    source: 'alias',
    reason: null,
    provider: 'olivepanther6@primal.net'
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(authenticateWithRole).mockResolvedValue(adminAuth)
  vi.mocked(verifyAddressProtocols).mockResolvedValue(okResult as never)
})

describe('POST /api/lightning-addresses/verify-protocols', () => {
  it('verifies one address for an admin', async () => {
    const req = createNextRequest('/api/lightning-addresses/verify-protocols', {
      method: 'POST',
      body: { username: 'misscons' }
    })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(authenticateWithRole).toHaveBeenCalledWith(req, Role.ADMIN)
    expect(verifyAddressProtocols).toHaveBeenCalledWith('misscons')
    expect(body).toMatchObject({
      username: 'misscons',
      probed: true,
      persisted: true
    })
  })

  it('rejects operators', async () => {
    vi.mocked(authenticateWithRole).mockRejectedValue(
      new AuthorizationError('Not authorized to access this resource')
    )

    const req = createNextRequest('/api/lightning-addresses/verify-protocols', {
      method: 'POST',
      body: { username: 'misscons' }
    })
    const res = await POST(req)
    await assertResponse(res, 403)
    expect(verifyAddressProtocols).not.toHaveBeenCalled()
  })

  it('rejects an invalid username', async () => {
    const req = createNextRequest('/api/lightning-addresses/verify-protocols', {
      method: 'POST',
      body: { username: 'Not Valid!' }
    })
    const res = await POST(req)
    await assertResponse(res, 400)
    expect(verifyAddressProtocols).not.toHaveBeenCalled()
  })
})
