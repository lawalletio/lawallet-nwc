import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { Role } from '@/lib/auth/permissions'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 },
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))

vi.mock('@/lib/activity-log', async importActual => ({
  ...(await importActual<typeof import('@/lib/activity-log')>()),
  logActivity: { fireAndForget: vi.fn() },
}))

vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))

import { PUT } from '@/app/api/users/[userId]/relays/route'
import { authenticate } from '@/lib/auth/unified-auth'

const ownerPubkey = 'a'.repeat(64)
const otherPubkey = 'b'.repeat(64)

const mockAuth = (pubkey: string, role: Role = Role.USER) =>
  vi.mocked(authenticate).mockResolvedValue({ role, pubkey, method: 'jwt' } as any)

function put(userId: string, body: unknown) {
  return PUT(
    createNextRequest(`/api/users/${userId}/relays`, { method: 'PUT', body }) as any,
    createParamsPromise({ userId }),
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('PUT /api/users/[userId]/relays', () => {
  it('lets the owner set their relays', async () => {
    mockAuth(ownerPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'u1', pubkey: ownerPubkey } as any)
    vi.mocked(prismaMock.user.update).mockResolvedValue({ id: 'u1' } as any)

    const res = await put('u1', { relays: ['wss://lacrypta.ar', 'wss://relay.damus.io'] })
    const body: any = await assertResponse(res, 200)

    expect(body.relays).toEqual(['wss://lacrypta.ar', 'wss://relay.damus.io'])
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          relays: JSON.stringify(['wss://lacrypta.ar', 'wss://relay.damus.io']),
          relaysUpdatedAt: expect.any(Date),
        }),
      }),
    )
  })

  it('dedups relays case- and trailing-slash-insensitively', async () => {
    mockAuth(ownerPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'u1', pubkey: ownerPubkey } as any)
    vi.mocked(prismaMock.user.update).mockResolvedValue({ id: 'u1' } as any)

    const res = await put('u1', {
      relays: ['wss://lacrypta.ar', 'wss://LaCrypta.ar/', 'wss://nos.lol'],
    })
    const body: any = await assertResponse(res, 200)

    expect(body.relays).toEqual(['wss://lacrypta.ar', 'wss://nos.lol'])
  })

  it('clears the preference (null) on an empty array', async () => {
    mockAuth(ownerPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'u1', pubkey: ownerPubkey } as any)
    vi.mocked(prismaMock.user.update).mockResolvedValue({ id: 'u1' } as any)

    await assertResponse(await put('u1', { relays: [] }), 200)
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ relays: null, relaysUpdatedAt: expect.any(Date) }),
      }),
    )
  })

  it('rejects a non-owner with 403 and does not write', async () => {
    mockAuth(otherPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'u1', pubkey: ownerPubkey } as any)

    await assertResponse(await put('u1', { relays: ['wss://nos.lol'] }), 403)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('rejects non-ws(s) relay URLs with 400', async () => {
    mockAuth(ownerPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({ id: 'u1', pubkey: ownerPubkey } as any)

    await assertResponse(await put('u1', { relays: ['https://not-a-relay.example'] }), 400)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('returns 404 for an unknown user', async () => {
    mockAuth(ownerPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null as any)

    await assertResponse(await put('nope', { relays: ['wss://nos.lol'] }), 404)
  })
})
