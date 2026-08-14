import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    jwt: { secret: 'test-secret-32-characters-long-xx' }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/jwt', () => ({
  verifyJwtToken: vi.fn()
}))

vi.mock('@/lib/nip98', () => ({
  validateNip98QueryToken: vi.fn()
}))

vi.mock('@/lib/auth/resolve-role', () => ({
  resolveRole: vi.fn()
}))

const { addClientMock, removeClientMock } = vi.hoisted(() => ({
  addClientMock: vi.fn(),
  removeClientMock: vi.fn()
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: {
    addClient: addClientMock,
    removeClient: removeClientMock
  }
}))

import { GET } from '@/app/api/events/route'
import { verifyJwtToken } from '@/lib/jwt'
import { validateNip98QueryToken } from '@/lib/nip98'
import { resolveRole } from '@/lib/auth/resolve-role'
import { getConfig } from '@/lib/config'

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'))
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/events', () => {
  it('returns 401 when token query parameter is missing', async () => {
    const res = await GET(makeRequest('/api/events'))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('Missing token')
    expect(addClientMock).not.toHaveBeenCalled()
  })

  it('returns 503 when JWT is not configured', async () => {
    vi.mocked(getConfig).mockReturnValueOnce({
      maintenance: { enabled: false },
      jwt: { secret: '' }
    } as any)

    const res = await GET(makeRequest('/api/events?token=aa.bb.cc'))

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('JWT not configured')
  })

  it('returns 401 when JWT verification fails', async () => {
    vi.mocked(verifyJwtToken).mockImplementation(() => {
      throw new Error('bad token')
    })

    const res = await GET(makeRequest('/api/events?token=in.va.lid'))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('Invalid or expired')
    expect(addClientMock).not.toHaveBeenCalled()
  })

  it('opens SSE stream with correct headers and registers client for ADMIN', async () => {
    vi.mocked(verifyJwtToken).mockReturnValue({
      payload: {
        userId: 'u1',
        pubkey: 'a'.repeat(64),
        role: 'ADMIN',
        iat: 0,
        exp: 9_999_999_999
      },
      header: {}
    } as any)

    const res = await GET(makeRequest('/api/events?token=va.li.d'))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toContain('no-cache')
    expect(res.headers.get('Connection')).toBe('keep-alive')
    expect(res.headers.get('X-Accel-Buffering')).toBe('no')

    // Client registered with the full ADMIN permission set
    expect(addClientMock).toHaveBeenCalledTimes(1)
    const client = addClientMock.mock.calls[0][0]
    expect(client.id).toBeTruthy()
    expect(Array.isArray(client.permissions)).toBe(true)
    expect(client.permissions.length).toBeGreaterThan(0)

    // Drain first chunk — should be the `connected` event
    const reader = res.body!.getReader()
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toMatch(/^event: connected\n/)
    expect(text).toContain('"clientId"')

    // Cancel the stream → client removed
    await reader.cancel()
    expect(removeClientMock).toHaveBeenCalledWith(client.id)
  })

  it('registers USER with empty permission set', async () => {
    vi.mocked(verifyJwtToken).mockReturnValue({
      payload: {
        userId: 'u1',
        pubkey: 'a'.repeat(64),
        role: 'USER',
        iat: 0,
        exp: 9_999_999_999
      },
      header: {}
    } as any)

    const res = await GET(makeRequest('/api/events?token=va.li.d'))
    expect(res.status).toBe(200)

    const client = addClientMock.mock.calls[0][0]
    expect(client.permissions).toEqual([])

    await res.body!.cancel()
  })

  it('falls back to empty permissions when role is invalid', async () => {
    vi.mocked(verifyJwtToken).mockReturnValue({
      payload: {
        userId: 'u1',
        pubkey: 'a'.repeat(64),
        role: 'NOT_A_REAL_ROLE',
        iat: 0,
        exp: 9_999_999_999
      },
      header: {}
    } as any)

    const res = await GET(makeRequest('/api/events?token=va.li.d'))
    expect(res.status).toBe(200)

    const client = addClientMock.mock.calls[0][0]
    expect(client.permissions).toEqual([])

    await res.body!.cancel()
  })
})

describe('GET /api/events with a NIP-98 query token', () => {
  // Anything without the JWT's two dots routes to the NIP-98 branch.
  const nip98Token = 'bm90LWEtand0'

  it('opens the stream for a valid signed event, resolving role from the DB', async () => {
    vi.mocked(validateNip98QueryToken).mockResolvedValue({
      pubkey: 'b'.repeat(64),
      event: {} as any
    })
    vi.mocked(resolveRole).mockResolvedValue('ADMIN' as any)

    const res = await GET(makeRequest(`/api/events?token=${nip98Token}`))

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(validateNip98QueryToken).toHaveBeenCalledWith(
      expect.anything(),
      nip98Token
    )
    expect(resolveRole).toHaveBeenCalledWith('b'.repeat(64))
    expect(verifyJwtToken).not.toHaveBeenCalled()

    const client = addClientMock.mock.calls[0][0]
    expect(client.permissions.length).toBeGreaterThan(0)

    await res.body!.cancel()
  })

  it('registers USER pubkeys with an empty permission set', async () => {
    vi.mocked(validateNip98QueryToken).mockResolvedValue({
      pubkey: 'c'.repeat(64),
      event: {} as any
    })
    vi.mocked(resolveRole).mockResolvedValue('USER' as any)

    const res = await GET(makeRequest(`/api/events?token=${nip98Token}`))
    expect(res.status).toBe(200)

    const client = addClientMock.mock.calls[0][0]
    expect(client.permissions).toEqual([])

    await res.body!.cancel()
  })

  it('returns 401 when the event fails validation', async () => {
    vi.mocked(validateNip98QueryToken).mockRejectedValue(
      new Error('Event validation failed')
    )

    const res = await GET(makeRequest(`/api/events?token=${nip98Token}`))

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toContain('Invalid or expired')
    expect(addClientMock).not.toHaveBeenCalled()
  })

  it('returns 503 when role resolution is unavailable', async () => {
    vi.mocked(validateNip98QueryToken).mockResolvedValue({
      pubkey: 'd'.repeat(64),
      event: {} as any
    })
    vi.mocked(resolveRole).mockRejectedValue(new Error('db down'))

    const res = await GET(makeRequest(`/api/events?token=${nip98Token}`))

    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain('Role resolution')
    expect(addClientMock).not.toHaveBeenCalled()
  })
})
