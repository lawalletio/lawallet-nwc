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
  // Reset global fetch mock
  vi.restoreAllMocks()
})

describe('POST /api/waitlist/subscribe', () => {
  it('subscribes email successfully', async () => {
    vi.mocked(getConfig).mockReturnValue({
      sendy: {
        enabled: true,
        url: 'https://sendy.test',
        listId: 'list123',
        apiKey: 'key123',
      },
      maintenance: { enabled: false },
    } as any)

    // Mock global fetch for Sendy
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('1', { status: 200 })
    )

    const req = createNextRequest('/api/waitlist/subscribe', {
      method: 'POST',
      body: { email: 'test@example.com' },
    })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ success: true })
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://sendy.test/subscribe',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('handles Sendy failure response', async () => {
    vi.mocked(getConfig).mockReturnValue({
      sendy: {
        enabled: true,
        url: 'https://sendy.test',
        listId: 'list123',
        apiKey: 'key123',
      },
      maintenance: { enabled: false },
    } as any)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Invalid email', { status: 200 })
    )

    const req = createNextRequest('/api/waitlist/subscribe', {
      method: 'POST',
      body: { email: 'test@example.com' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('returns error when Sendy is not configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      sendy: { enabled: false, url: undefined, listId: undefined, apiKey: undefined },
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
      sendy: { enabled: true, url: 'https://sendy.test', listId: 'l', apiKey: 'k' },
      maintenance: { enabled: false },
    } as any)

    const req = createNextRequest('/api/waitlist/subscribe', {
      method: 'POST',
      body: { email: 'not-an-email' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('includes name in Sendy request when provided', async () => {
    vi.mocked(getConfig).mockReturnValue({
      sendy: {
        enabled: true,
        url: 'https://sendy.test',
        listId: 'list123',
        apiKey: 'key123',
      },
      maintenance: { enabled: false },
    } as any)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('1', { status: 200 })
    )

    const req = createNextRequest('/api/waitlist/subscribe', {
      method: 'POST',
      body: { email: 'test@example.com', name: 'Test User' },
    })
    const res = await POST(req)
    await assertResponse(res, 200)

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0]
    const body = fetchCall[1]?.body as string
    expect(body).toContain('name=Test+User')
  })
})
