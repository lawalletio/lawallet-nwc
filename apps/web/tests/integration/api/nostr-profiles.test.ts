import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { AuthenticationError } from '@/types/server/errors'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn()
  })),
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn()
}))

vi.mock('@/lib/nostr/profile-cache', () => ({
  resolveProfiles: vi.fn()
}))

import { POST } from '@/app/api/nostr/profiles/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveProfiles } from '@/lib/nostr/profile-cache'

const PUBKEY = 'a'.repeat(64)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: PUBKEY,
    role: 'USER' as any,
    method: 'jwt'
  })
})

describe('POST /api/nostr/profiles', () => {
  it('returns cached profiles for an authenticated batch request', async () => {
    vi.mocked(resolveProfiles).mockResolvedValue([
      {
        pubkey: PUBKEY,
        npub: 'npub1cached',
        name: 'alice',
        fetchedAt: 123
      }
    ])

    const req = createNextRequest('/api/nostr/profiles', {
      method: 'POST',
      body: { pubkeys: [PUBKEY], force: true }
    })
    const res = await POST(req)
    const body: any = await assertResponse(res, 200)

    expect(resolveProfiles).toHaveBeenCalledWith([PUBKEY], { force: true })
    expect(body.profiles).toEqual([
      {
        pubkey: PUBKEY,
        npub: 'npub1cached',
        name: 'alice',
        fetchedAt: 123
      }
    ])
  })

  it('rejects unauthenticated requests', async () => {
    vi.mocked(authenticate).mockRejectedValue(
      new AuthenticationError('no auth')
    )

    const req = createNextRequest('/api/nostr/profiles', {
      method: 'POST',
      body: { pubkeys: [PUBKEY] }
    })
    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(resolveProfiles).not.toHaveBeenCalled()
  })

  it('rejects invalid request bodies', async () => {
    const req = createNextRequest('/api/nostr/profiles', {
      method: 'POST',
      body: { pubkeys: [] }
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(resolveProfiles).not.toHaveBeenCalled()
  })

  it('returns 400 for malformed JSON (not 500)', async () => {
    const req = new Request('http://localhost:3000/api/nostr/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"pubkeys": ["abc"'
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toBe('Malformed JSON in request body')
    expect(resolveProfiles).not.toHaveBeenCalled()
  })

  it('returns 400 for completely invalid JSON', async () => {
    const req = new Request('http://localhost:3000/api/nostr/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all'
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(resolveProfiles).not.toHaveBeenCalled()
  })

  it('returns 400 for empty body', async () => {
    const req = new Request('http://localhost:3000/api/nostr/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: ''
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(resolveProfiles).not.toHaveBeenCalled()
  })
})
