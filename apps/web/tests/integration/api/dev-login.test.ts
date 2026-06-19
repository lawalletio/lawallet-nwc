import { describe, it, expect, vi, afterEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { enabled: true, secret: 'x'.repeat(40) },
    maintenance: { enabled: false },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

// The route doesn't touch the DB, but its `withErrorHandling` wrapper imports
// the activity log which instantiates the Prisma client at module load.
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { POST } from '@/app/api/dev/login/route'

function decodePayload(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/dev/login', () => {
  it('mints an ADMIN JWT in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')

    const res = await POST(createNextRequest('/api/dev/login', { method: 'POST' }))
    const body: any = await assertResponse(res, 200)

    expect(body.token).toBeTruthy()
    const payload = decodePayload(body.token)
    expect(payload.role).toBe('ADMIN')
    expect(payload.permissions).toContain('cards:write')
    expect(payload.iss).toBe('lawallet-nwc')
    expect(payload.aud).toBe('lawallet-users')
  })

  it.each(['production', 'test', 'staging', ''])(
    'is unavailable unless NODE_ENV is exactly "development" (%s → 404)',
    async env => {
      vi.stubEnv('NODE_ENV', env)

      const res = await POST(createNextRequest('/api/dev/login', { method: 'POST' }))

      expect(res.status).toBe(404)
    }
  )
})
