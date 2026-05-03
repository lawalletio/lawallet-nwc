import { describe, it, expect, vi } from 'vitest'
import { createNextRequest, getResponseJson } from '@/tests/helpers/api-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ env: 'test', maintenance: { enabled: false } })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn,
}))

vi.mock('@/lib/activity-log', () => {
  const logActivity = Object.assign(vi.fn(), { fireAndForget: vi.fn() })
  return { logActivity, ActivityEvent: {} }
})

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

describe('GET /api/openapi.json', () => {
  it('returns the generated OpenAPI 3.1 document', async () => {
    const { GET } = await import('@/app/api/openapi.json/route')
    const res = await GET(createNextRequest('/api/openapi.json'))

    expect(res.status).toBe(200)
    const body = (await getResponseJson(res)) as {
      openapi: string
      info: { title: string }
      paths: Record<string, unknown>
      components?: { schemas?: Record<string, unknown> }
    }

    expect(body.openapi).toBe('3.1.0')
    expect(body.info.title).toBe('LaWallet NWC API')
    expect(Object.keys(body.paths)).toContain('/api/cards')
    expect(Object.keys(body.paths)).toContain('/api/lud16/{username}')
    expect(body.components?.schemas?.ErrorEnvelope).toBeDefined()
  })
})
