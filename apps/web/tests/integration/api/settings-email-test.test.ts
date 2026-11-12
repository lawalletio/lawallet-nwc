// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest } from '@/tests/helpers/api-helpers'

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
  RateLimitPresets: { sensitive: {} }
}))
vi.mock('@/lib/settings-auth', () => ({
  authenticateSettingsWriteRequest: vi.fn()
}))
vi.mock('@/lib/email/send', () => ({ sendEmail: vi.fn() }))

import { POST } from '@/app/api/settings/email-test/route'
import { authenticateSettingsWriteRequest } from '@/lib/settings-auth'
import { sendEmail } from '@/lib/email/send'
import { AuthorizationError } from '@/types/server/errors'

const post = (body: unknown) =>
  POST(
    createNextRequest('http://localhost:3000/api/settings/email-test', {
      method: 'POST',
      body
    })
  )

beforeEach(() => {
  vi.mocked(authenticateSettingsWriteRequest)
    .mockReset()
    .mockResolvedValue('a'.repeat(64))
  vi.mocked(sendEmail).mockReset()
})

describe('POST /api/settings/email-test', () => {
  it('requires the settings-write permission', async () => {
    vi.mocked(authenticateSettingsWriteRequest).mockRejectedValue(
      new AuthorizationError('Forbidden')
    )
    const res = await post({ provider: 'smtp', to: 'a@b.co' })
    expect(res.status).toBe(403)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends the test template through the chosen provider', async () => {
    const res = await post({ provider: 'resend', to: 'a@b.co' })
    expect(await res.json()).toEqual({ ok: true })
    expect(vi.mocked(sendEmail).mock.calls[0][0]).toMatchObject({
      to: 'a@b.co',
      template: 'test',
      provider: 'resend'
    })
  })

  it('reports a delivery failure as a result, not a server error', async () => {
    vi.mocked(sendEmail).mockRejectedValue(new Error('535 auth failed'))
    const res = await post({ provider: 'smtp', to: 'a@b.co' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, error: '535 auth failed' })
  })

  it('rejects an unknown provider', async () => {
    const res = await post({ provider: 'mailgun', to: 'a@b.co' })
    expect(res.status).toBe(400)
  })
})
