import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

// Mock dependencies
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 },
  })),
  resetConfig: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { auth: {}, cardScan: {}, sensitive: {}, default: {} },
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/admin-auth', () => ({
  validateAdminAuth: vi.fn(),
  validateNip98Auth: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

import { GET, POST } from '@/app/api/settings/route'
import { validateNip98Auth } from '@/lib/admin-auth'
import { getSettings } from '@/lib/settings'

const mockPubkey = 'a'.repeat(64)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /api/settings', () => {
  it('returns full settings when authenticated as root', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(getSettings).mockResolvedValue({
      root: mockPubkey,
      domain: 'test.com',
      endpoint: 'https://test.com',
    })

    const req = createNextRequest('/api/settings')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      root: mockPubkey,
      domain: 'test.com',
      endpoint: 'https://test.com',
    })
  })

  it('returns minimal settings when not authenticated', async () => {
    vi.mocked(validateNip98Auth).mockRejectedValue(new Error('no auth'))
    vi.mocked(getSettings).mockResolvedValue({
      root: mockPubkey,
      domain: 'test.com',
      endpoint: 'https://test.com',
    })

    const req = createNextRequest('/api/settings')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ domain: 'test.com', endpoint: 'https://test.com' })
  })

  it('returns minimal settings when authenticated as non-root', async () => {
    const otherPubkey = 'b'.repeat(64)
    vi.mocked(validateNip98Auth).mockResolvedValue(otherPubkey)
    vi.mocked(getSettings).mockResolvedValue({
      root: mockPubkey,
      domain: 'test.com',
      endpoint: 'https://test.com',
    })

    const req = createNextRequest('/api/settings')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ domain: 'test.com', endpoint: 'https://test.com' })
  })
})

describe('POST /api/settings', () => {
  it('updates settings when authenticated as root', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })
    vi.mocked(prismaMock.settings.upsert).mockResolvedValue({} as any)

    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { domain: 'new.com' },
    })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ message: 'Settings updated successfully', count: 1 })
    expect(prismaMock.settings.upsert).toHaveBeenCalledWith({
      where: { name: 'domain' },
      update: { value: 'new.com' },
      create: { name: 'domain', value: 'new.com' },
    })
  })

  it('rejects non-root user', async () => {
    const otherPubkey = 'b'.repeat(64)
    vi.mocked(validateNip98Auth).mockResolvedValue(otherPubkey)
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })

    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { domain: 'new.com' },
    })
    const res = await POST(req)

    expect(res.status).toBe(403)
  })

  it('rejects invalid setting names', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })

    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { 'INVALID KEY!': 'value' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })

  it('handles multiple settings at once', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })
    vi.mocked(prismaMock.settings.upsert).mockResolvedValue({} as any)

    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { domain: 'new.com', endpoint: 'https://new.com' },
    })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ message: 'Settings updated successfully', count: 2 })
    expect(prismaMock.settings.upsert).toHaveBeenCalledTimes(2)
  })

  it('rejects unauthenticated request', async () => {
    vi.mocked(validateNip98Auth).mockRejectedValue(new Error('no auth'))

    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { domain: 'new.com' },
    })
    const res = await POST(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
