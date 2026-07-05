import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

// Mock dependencies
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 }
  })),
  resetConfig: vi.fn()
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: { auth: {}, cardScan: {}, sensitive: {}, default: {} }
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))

vi.mock('@/lib/admin-auth', () => ({
  validateAdminAuth: vi.fn(),
  validateNip98Auth: vi.fn()
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn()
}))

const listenerState = vi.hoisted(() => ({
  enabled: false,
  url: null as string | null,
  secret: null as string | null,
  urlSource: 'none' as 'settings' | 'env' | 'none',
  secretSource: 'none' as 'settings' | 'env' | 'none'
}))

// Plain function (not vi.fn) so the blanket `vi.resetAllMocks()` in
// beforeEach can't strip its implementation.
vi.mock('@/lib/listener-config', () => ({
  getListenerConfig: async () => ({
    enabled: listenerState.enabled,
    url: listenerState.url,
    secret: listenerState.secret,
    requestTimeoutMs: 10000,
    urlSource: listenerState.urlSource,
    secretSource: listenerState.secretSource,
    enabledSource: 'settings'
  })
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
      endpoint: 'app'
    })

    const req = createNextRequest('/api/settings')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      root: mockPubkey,
      domain: 'test.com',
      endpoint: 'app',
      subdomain: 'app',
      hasRoot: true,
      // Computed NWC-listener keys (full response only)
      listener_enabled: 'false',
      listener_url_source: 'none',
      listener_secret_source: 'none',
      listener_url_effective: ''
    })
  })

  it('returns minimal settings when not authenticated', async () => {
    vi.mocked(validateNip98Auth).mockRejectedValue(new Error('no auth'))
    vi.mocked(getSettings).mockResolvedValue({
      root: mockPubkey,
      domain: 'test.com',
      endpoint: 'app'
    })

    const req = createNextRequest('/api/settings')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      domain: 'test.com',
      endpoint: 'app',
      subdomain: 'app',
      hasRoot: true
    })
  })

  it('returns minimal settings when authenticated as non-root', async () => {
    const otherPubkey = 'b'.repeat(64)
    vi.mocked(validateNip98Auth).mockResolvedValue(otherPubkey)
    vi.mocked(getSettings).mockResolvedValue({
      root: mockPubkey,
      domain: 'test.com',
      endpoint: 'app'
    })

    const req = createNextRequest('/api/settings')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      domain: 'test.com',
      endpoint: 'app',
      subdomain: 'app',
      hasRoot: true
    })
  })

  it('falls back to legacy subdomain setting when endpoint is missing', async () => {
    vi.mocked(validateNip98Auth).mockRejectedValue(new Error('no auth'))
    vi.mocked(getSettings).mockResolvedValue({
      domain: 'test.com',
      subdomain: 'wallet'
    })

    const req = createNextRequest('/api/settings')
    const res = await GET(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({
      domain: 'test.com',
      endpoint: 'wallet',
      subdomain: 'wallet',
      hasRoot: false
    })
  })
})

describe('POST /api/settings', () => {
  it('updates settings when authenticated as root', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })
    vi.mocked(prismaMock.settings.upsert).mockResolvedValue({} as any)

    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { domain: 'new.com' }
    })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ message: 'Settings updated successfully', count: 2 })
    expect(prismaMock.settings.upsert).toHaveBeenCalledWith({
      where: { name: 'domain' },
      update: { value: 'new.com' },
      create: { name: 'domain', value: 'new.com' }
    })
    expect(prismaMock.settings.upsert).toHaveBeenCalledWith({
      where: { name: 'domain_verified' },
      update: { value: 'false' },
      create: { name: 'domain_verified', value: 'false' }
    })
  })

  it('rejects non-root user', async () => {
    const otherPubkey = 'b'.repeat(64)
    vi.mocked(validateNip98Auth).mockResolvedValue(otherPubkey)
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })

    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { domain: 'new.com' }
    })
    const res = await POST(req)

    expect(res.status).toBe(403)
  })

  it('rejects invalid setting names', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })

    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { 'INVALID KEY!': 'value' }
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
      body: { domain: 'new.com', endpoint: 'app' }
    })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ message: 'Settings updated successfully', count: 3 })
    expect(prismaMock.settings.upsert).toHaveBeenCalledTimes(3)
  })

  it('maps subdomain updates to the endpoint setting', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })
    vi.mocked(prismaMock.settings.upsert).mockResolvedValue({} as any)

    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { subdomain: 'wallet' }
    })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ message: 'Settings updated successfully', count: 2 })
    expect(prismaMock.settings.upsert).toHaveBeenCalledWith({
      where: { name: 'endpoint' },
      update: { value: 'wallet' },
      create: { name: 'endpoint', value: 'wallet' }
    })
    expect(prismaMock.settings.upsert).toHaveBeenCalledWith({
      where: { name: 'domain_verified' },
      update: { value: 'false' },
      create: { name: 'domain_verified', value: 'false' }
    })
  })

  it('does not allow clients to set domain verification directly', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })
    vi.mocked(prismaMock.settings.upsert).mockResolvedValue({} as any)

    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { domain_verified: 'true' }
    })
    const res = await POST(req)
    const body = await assertResponse(res, 200)

    expect(body).toEqual({ message: 'Settings updated successfully', count: 0 })
    expect(prismaMock.settings.upsert).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated request', async () => {
    vi.mocked(validateNip98Auth).mockRejectedValue(new Error('no auth'))

    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { domain: 'new.com' }
    })
    const res = await POST(req)

    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  describe('paid registration precondition', () => {
    const originalFetch = global.fetch
    afterEach(() => {
      global.fetch = originalFetch
    })

    it('rejects when enabling paid registration with an empty LN address', async () => {
      vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
      vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })

      const req = createNextRequest('/api/settings', {
        method: 'POST',
        body: {
          registration_ln_enabled: 'true',
          registration_ln_address: '',
          registration_price: '21'
        }
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
      expect(prismaMock.settings.upsert).not.toHaveBeenCalled()
    })

    it('rejects when the configured LN address does not expose LUD-21 verify', async () => {
      vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
      vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })
      global.fetch = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/.well-known/lnurlp/')) {
          return {
            ok: true,
            json: async () => ({
              tag: 'payRequest',
              callback: 'https://provider.com/cb',
              minSendable: 1000,
              maxSendable: 1_000_000_000
            })
          } as any
        }
        return {
          ok: true,
          json: async () => ({ pr: 'lnbc...' }) // no verify
        } as any
      }) as any

      const req = createNextRequest('/api/settings', {
        method: 'POST',
        body: {
          registration_ln_enabled: 'true',
          registration_ln_address: 'admin@provider.com',
          registration_price: '21'
        }
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
      const body: any = await res.json()
      expect(body.error.message).toMatch(/LUD-21/)
      expect(prismaMock.settings.upsert).not.toHaveBeenCalled()
    })

    it('accepts when the configured LN address supports LUD-21 verify', async () => {
      vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
      vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })
      vi.mocked(prismaMock.settings.upsert).mockResolvedValue({} as any)
      global.fetch = vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/.well-known/lnurlp/')) {
          return {
            ok: true,
            json: async () => ({
              tag: 'payRequest',
              callback: 'https://provider.com/cb',
              minSendable: 1000,
              maxSendable: 1_000_000_000
            })
          } as any
        }
        return {
          ok: true,
          json: async () => ({
            pr: 'lnbc...',
            verify: 'https://provider.com/verify/xyz'
          })
        } as any
      }) as any

      const req = createNextRequest('/api/settings', {
        method: 'POST',
        body: {
          registration_ln_enabled: 'true',
          registration_ln_address: 'admin@provider.com',
          registration_price: '21'
        }
      })
      const res = await POST(req)

      await assertResponse(res, 200)
      expect(prismaMock.settings.upsert).toHaveBeenCalled()
    })

    it('does not probe when only non-registration settings change', async () => {
      vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
      vi.mocked(getSettings).mockResolvedValue({
        root: mockPubkey,
        registration_ln_enabled: 'false'
      })
      vi.mocked(prismaMock.settings.upsert).mockResolvedValue({} as any)
      const fetchSpy = vi.fn()
      global.fetch = fetchSpy as any

      const req = createNextRequest('/api/settings', {
        method: 'POST',
        body: { domain: 'new.com' }
      })
      const res = await POST(req)

      await assertResponse(res, 200)
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})

describe('NWC listener settings', () => {
  const authAsRoot = () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })
    vi.mocked(prismaMock.settings.upsert).mockResolvedValue({} as any)
  }

  it('GET (full) includes the computed listener keys', async () => {
    vi.mocked(validateNip98Auth).mockResolvedValue(mockPubkey)
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })
    listenerState.enabled = true
    listenerState.url = 'http://listener.test:4100'
    listenerState.urlSource = 'env'
    listenerState.secretSource = 'env'

    const req = createNextRequest('/api/settings')
    const body: any = await assertResponse(await GET(req), 200)

    expect(body.listener_enabled).toBe('true')
    expect(body.listener_url_source).toBe('env')
    expect(body.listener_secret_source).toBe('env')
    expect(body.listener_url_effective).toBe('http://listener.test:4100')

    listenerState.enabled = false
    listenerState.url = null
    listenerState.urlSource = 'none'
    listenerState.secretSource = 'none'
  })

  it('GET (public) does NOT include the computed listener keys', async () => {
    vi.mocked(validateNip98Auth).mockRejectedValue(new Error('no auth'))
    vi.mocked(getSettings).mockResolvedValue({ root: mockPubkey })

    const body: any = await assertResponse(
      await GET(createNextRequest('/api/settings')),
      200
    )
    expect(body.listener_enabled).toBeUndefined()
    expect(body.listener_url_effective).toBeUndefined()
  })

  it('rejects a malformed listener_url', async () => {
    authAsRoot()
    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { listener_url: 'not a url' }
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(prismaMock.settings.upsert).not.toHaveBeenCalled()
  })

  it('rejects a listener_auth_secret shorter than 32 chars', async () => {
    authAsRoot()
    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { listener_auth_secret: 'too-short' }
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('accepts clearing url/secret with empty strings', async () => {
    authAsRoot()
    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { listener_url: '', listener_auth_secret: '' }
    })
    await assertResponse(await POST(req), 200)
  })

  it('rejects enabling without a resolvable url + secret', async () => {
    authAsRoot()
    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { listener_enabled: 'true' }
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    expect(prismaMock.settings.upsert).not.toHaveBeenCalled()
  })

  it('allows enabling when url + secret are posted together', async () => {
    authAsRoot()
    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: {
        listener_enabled: 'true',
        listener_url: 'https://listener.example.com',
        listener_auth_secret: 'a'.repeat(40)
      }
    })
    await assertResponse(await POST(req), 200)
    expect(prismaMock.settings.upsert).toHaveBeenCalledWith({
      where: { name: 'listener_enabled' },
      update: { value: 'true' },
      create: { name: 'listener_enabled', value: 'true' }
    })
  })

  it('allows disabling regardless of config', async () => {
    authAsRoot()
    const req = createNextRequest('/api/settings', {
      method: 'POST',
      body: { listener_enabled: 'false' }
    })
    await assertResponse(await POST(req), 200)
  })
})
