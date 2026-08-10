import { describe, it, expect, vi, afterEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { DEV_ADMIN_PUBKEY, DEV_ADMIN_USER_ID } from '@/lib/dev-identity'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { enabled: true, secret: 'x'.repeat(40) },
    maintenance: { enabled: false }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

// The route upserts the dev admin identity (the session-JWT role claim is
// re-resolved from the DB on every request, so the row must exist); the
// `withErrorHandling` wrapper also imports the activity log which
// instantiates the Prisma client at module load.
vi.mock('@/lib/prisma', () => ({
  prisma: { user: { upsert: vi.fn().mockResolvedValue({}) } }
}))

import { POST } from '@/app/api/dev/login/route'
import { prisma } from '@/lib/prisma'

function decodePayload(jwt: string) {
  return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/dev/login', () => {
  it('mints an ADMIN JWT in development with ENABLE_DEV_ROUTES=true', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_DEV_ROUTES', 'true')

    const res = await POST(
      createNextRequest('/api/dev/login', { method: 'POST' })
    )
    const body: any = await assertResponse(res, 200)

    expect(body.token).toBeTruthy()
    const payload = decodePayload(body.token)
    expect(payload.role).toBe('ADMIN')
    expect(payload.userId).toBe(DEV_ADMIN_USER_ID)
    expect(payload.pubkey).toBe(DEV_ADMIN_PUBKEY)
    expect(payload.pubkey).toMatch(/^[0-9a-f]{64}$/)
    expect(payload.permissions).toContain('cards:write')
    expect(payload.iss).toBe('lawallet-nwc')
    expect(payload.aud).toBe('lawallet-users')

    // The minted claim is only a hint — the DB row must back it with ADMIN.
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { id: DEV_ADMIN_USER_ID },
      update: { pubkey: DEV_ADMIN_PUBKEY, role: 'ADMIN' },
      create: { id: DEV_ADMIN_USER_ID, pubkey: DEV_ADMIN_PUBKEY, role: 'ADMIN' }
    })
  })

  it('is unavailable in development without the ENABLE_DEV_ROUTES opt-in', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ENABLE_DEV_ROUTES', '')

    const res = await POST(
      createNextRequest('/api/dev/login', { method: 'POST' })
    )

    expect(res.status).toBe(404)
  })

  it.each(['production', 'test', 'staging', ''])(
    'is unavailable without the opt-in (%s → 404)',
    async env => {
      vi.stubEnv('NODE_ENV', env)
      vi.stubEnv('ENABLE_DEV_ROUTES', '')

      const res = await POST(
        createNextRequest('/api/dev/login', { method: 'POST' })
      )

      expect(res.status).toBe(404)
    }
  )

  it('stays closed in production even with ENABLE_DEV_ROUTES=true', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ENABLE_DEV_ROUTES', 'true')

    const res = await POST(
      createNextRequest('/api/dev/login', { method: 'POST' })
    )

    expect(res.status).toBe(404)
  })
})
