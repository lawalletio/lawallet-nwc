import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {},
}))

import { POST } from '@/app/api/waitlist/subscribe/route'
import { getConfig } from '@/lib/config'

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('POST /api/waitlist/subscribe', () => {
  it('subscribes email successfully', async () => {
    vi.mocked(getConfig).mockReturnValue({
      tally: {
        enabled: true,
        apiKey: 'test-key',
        formId: 'test-form',
      },
      maintenance: { enabled: false },
    } as any)

    // Mock fetch: first call returns questions, second submits to Tally
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          questions: [{
            type: 'INPUT_EMAIL',
            id: 'BG4olK',
            fields: [{ uuid: 'field-uuid-123', blockGroupUuid: 'field-uuid-123' }]
          }]
        }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ submissionId: 'sub_123', respondentId: 'resp_123' }), { status: 200 })
      )

    const req = createNextRequest('/api/waitlist/subscribe', {
      method: 'POST',
      body: { email: 'test@example.com' },
    })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ success: true })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.tally.so/forms/test-form/questions',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key' }
      })
    )
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://tally.so/api/forms/test-form/respond',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
    )
  })

  it('handles Tally submission failure', async () => {
    vi.mocked(getConfig).mockReturnValue({
      tally: {
        enabled: true,
        apiKey: 'test-key',
        formId: 'test-form',
      },
      maintenance: { enabled: false },
    } as any)

    // Email field UUID is cached from previous test
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('Bad request', { status: 400 })
      )

    const req = createNextRequest('/api/waitlist/subscribe', {
      method: 'POST',
      body: { email: 'test@example.com' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('returns error when Tally is not configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      tally: { enabled: false, apiKey: undefined, formId: undefined },
      maintenance: { enabled: false },
    } as any)

    const req = createNextRequest('/api/waitlist/subscribe', {
      method: 'POST',
      body: { email: 'test@example.com' },
    })
    const res = await POST(req)

    expect(res.status).toBe(500)
  })

  it('rejects invalid email', async () => {
    vi.mocked(getConfig).mockReturnValue({
      tally: { enabled: true, apiKey: 'k', formId: 'f' },
      maintenance: { enabled: false },
    } as any)

    const req = createNextRequest('/api/waitlist/subscribe', {
      method: 'POST',
      body: { email: 'not-an-email' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })
})
