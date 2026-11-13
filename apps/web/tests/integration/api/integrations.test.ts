// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 },
    nwcVault: { secret: 'v'.repeat(40), enabled: true }
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
vi.mock('@/lib/auth/unified-auth', () => ({
  authenticateWithPermission: vi.fn()
}))
vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {},
  logActivity: { fireAndForget: vi.fn() }
}))

import { GET } from '@/app/api/integrations/route'
import { PUT } from '@/app/api/integrations/[id]/route'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { AuthorizationError } from '@/types/server/errors'

const rows = (s: Record<string, string>) =>
  Object.entries(s).map(([name, value]) => ({ name, value }))

const put = (id: string, body: unknown) =>
  PUT(
    createNextRequest(`http://localhost:3000/api/integrations/${id}`, {
      method: 'PUT',
      body
    }),
    createParamsPromise({ id })
  )

beforeEach(() => {
  resetPrismaMock()
  vi.mocked(authenticateWithPermission)
    .mockReset()
    .mockResolvedValue({
      pubkey: 'a'.repeat(64),
      role: 'ADMIN',
      method: 'jwt'
    } as any)
  vi.mocked(prismaMock.settings.findMany).mockResolvedValue([])
})

describe('GET /api/integrations', () => {
  it('is admin-only', async () => {
    vi.mocked(authenticateWithPermission).mockRejectedValue(
      new AuthorizationError()
    )
    const res = await GET(
      createNextRequest('http://localhost:3000/api/integrations')
    )
    expect(res.status).toBe(403)
  })

  it('never returns secret values, only presence flags', async () => {
    vi.mocked(prismaMock.settings.findMany).mockResolvedValue(
      rows({ wapu_enabled: 'true', wapu_api_key: 'super-secret' }) as any
    )
    const res = await GET(
      createNextRequest('http://localhost:3000/api/integrations')
    )
    const text = await res.text()
    expect(text).not.toContain('super-secret')
    const wapu = JSON.parse(text).integrations.find((i: any) => i.id === 'wapu')
    expect(wapu).toMatchObject({
      enabled: true,
      configured: true,
      secretsConfigured: { wapu_api_key: true }
    })
  })
})

describe('PUT /api/integrations/[id]', () => {
  it('seals the secret before storing it', async () => {
    const res = await put('wapu', { config: { wapu_api_key: 'my-key' } })
    expect(res.status).toBe(200)
    const [call] = vi.mocked(prismaMock.settings.upsert).mock.calls as any[]
    expect(call[0].where).toEqual({ name: 'wapu_api_key' })
    expect(call[0].update.value).toMatch(/^lwrw1:/)
    expect(call[0].update.value).not.toContain('my-key')
  })

  it('keeps the stored secret when the field is blank', async () => {
    await put('wapu', { config: { wapu_api_key: '  ' } })
    expect(prismaMock.settings.upsert).not.toHaveBeenCalled()
    expect(prismaMock.settings.deleteMany).toHaveBeenCalledWith({
      where: { name: { in: [] } }
    })
  })

  it('refuses to enable an unconfigured integration', async () => {
    const res = await put('bullbitcoin', { enabled: true })
    expect(res.status).toBe(400)
    expect(prismaMock.settings.upsert).not.toHaveBeenCalled()
  })

  it('rejects keys that belong to another integration', async () => {
    const res = await put('alias', { config: { wapu_api_key: 'x' } })
    expect(res.status).toBe(400)
  })

  it('rejects a non-http alias URL', async () => {
    const res = await put('alias', {
      config: { alias_api_url: 'javascript:alert(1)' }
    })
    expect(res.status).toBe(400)
  })
})
