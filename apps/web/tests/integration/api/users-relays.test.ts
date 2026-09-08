import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { Role } from '@/lib/auth/permissions'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    maintenance: { enabled: false },
    requestLimits: { maxBodySize: 1048576, maxJsonSize: 1048576 }
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/events/event-bus', () => ({ eventBus: { emit: vi.fn() } }))

vi.mock('@/lib/activity-log', async importActual => ({
  ...(await importActual<typeof import('@/lib/activity-log')>()),
  logActivity: { fireAndForget: vi.fn() }
}))

vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))

import { PUT } from '@/app/api/users/[userId]/relays/route'
import { authenticate } from '@/lib/auth/unified-auth'

const ownerPubkey = 'a'.repeat(64)
const otherPubkey = 'b'.repeat(64)

const mockAuth = (pubkey: string, role: Role = Role.USER) =>
  vi
    .mocked(authenticate)
    .mockResolvedValue({ role, pubkey, method: 'jwt' } as any)

function put(userId: string, body: unknown) {
  return PUT(
    createNextRequest(`/api/users/${userId}/relays`, {
      method: 'PUT',
      body
    }) as any,
    createParamsPromise({ userId })
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('PUT /api/users/[userId]/relays', () => {
  it('lets the owner set their relays', async () => {
    mockAuth(ownerPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'u1',
      pubkey: ownerPubkey
    } as any)
    vi.mocked(prismaMock.user.update).mockResolvedValue({ id: 'u1' } as any)

    const res = await put('u1', {
      relays: ['wss://lacrypta.ar', 'wss://relay.damus.io']
    })
    const body: any = await assertResponse(res, 200)

    expect(body.relays).toEqual(['wss://lacrypta.ar', 'wss://relay.damus.io'])
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          relays: JSON.stringify(['wss://lacrypta.ar', 'wss://relay.damus.io']),
          relaysUpdatedAt: expect.any(Date)
        })
      })
    )
  })

  it('dedups relays case- and trailing-slash-insensitively', async () => {
    mockAuth(ownerPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'u1',
      pubkey: ownerPubkey
    } as any)
    vi.mocked(prismaMock.user.update).mockResolvedValue({ id: 'u1' } as any)

    const res = await put('u1', {
      relays: ['wss://lacrypta.ar', 'wss://LaCrypta.ar/', 'wss://nos.lol']
    })
    const body: any = await assertResponse(res, 200)

    expect(body.relays).toEqual(['wss://lacrypta.ar', 'wss://nos.lol'])
  })

  it('clears the preference (null) on an empty array', async () => {
    mockAuth(ownerPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'u1',
      pubkey: ownerPubkey
    } as any)
    vi.mocked(prismaMock.user.update).mockResolvedValue({ id: 'u1' } as any)

    await assertResponse(await put('u1', { relays: [] }), 200)
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          relays: null,
          relaysUpdatedAt: expect.any(Date)
        })
      })
    )
  })

  it('rejects a non-owner with 403 and does not write', async () => {
    mockAuth(otherPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'u1',
      pubkey: ownerPubkey
    } as any)
    // The caller's pubkey resolves to their OWN account (distinct from the
    // target) via the NostrIdentity seam.
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      user: { id: 'u2', pubkey: otherPubkey, role: 'USER' }
    } as any)

    await assertResponse(await put('u1', { relays: ['wss://nos.lol'] }), 403)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('rejects non-ws(s) relay URLs with 400', async () => {
    mockAuth(ownerPubkey)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'u1',
      pubkey: ownerPubkey
    } as any)

    await assertResponse(
      await put('u1', { relays: ['https://not-a-relay.example'] }),
      400
    )
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it("returns 403 (not 404) for an unknown target, so existence can't be probed", async () => {
    mockAuth(ownerPubkey)
    // Caller resolves to their own account via the NostrIdentity seam; the
    // target id does not resolve to any user.
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      user: { id: 'u1', pubkey: ownerPubkey, role: 'USER' }
    } as any)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null as any)

    await assertResponse(await put('nope', { relays: ['wss://nos.lol'] }), 403)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  // --- Existence-probe closure (hex-pubkey targets) ---
  // The pre-fix lookup-then-ownership ordering returned 404 for an unlinked
  // pubkey but 403 for a linked-but-not-owned one: a 1-bit "is this pubkey
  // tied to a LaWallet account" oracle. After the fix every non-owner probe —
  // linked or unlinked, account-less or account-holding — collapses to 403.
  const linkedTargetPubkey = 'c'.repeat(64)
  const unlinkedPubkey = 'd'.repeat(64)

  it('gives an account-less prober 403 whether the hex target is linked or not', async () => {
    // Account-less attacker: its own pubkey resolves to no account, so the
    // caller-side `!me` check rejects before the target is even looked up.
    mockAuth(otherPubkey)
    ;(prismaMock.nostrIdentity.findUnique as any).mockImplementation(
      (args: any) =>
        args.where.pubkey === linkedTargetPubkey
          ? Promise.resolve({
              user: { id: 'uB', pubkey: linkedTargetPubkey, role: 'USER' }
            } as any)
          : Promise.resolve(null)
    )
    ;(prismaMock.user.findUnique as any).mockImplementation((args: any) =>
      args.where.id === 'uB'
        ? Promise.resolve({ id: 'uB', pubkey: linkedTargetPubkey } as any)
        : Promise.resolve(null)
    )

    // Linked-but-not-owned target -> 403
    await assertResponse(
      await put(linkedTargetPubkey, { relays: ['wss://nos.lol'] }),
      403
    )
    // Unlinked target -> 403 (same status: no existence probe)
    await assertResponse(
      await put(unlinkedPubkey, { relays: ['wss://nos.lol'] }),
      403
    )
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('gives a non-owner with an account 403 whether the hex target is linked or not', async () => {
    // The caller has their OWN account (u2) but probes other pubkeys.
    mockAuth(ownerPubkey)
    ;(prismaMock.nostrIdentity.findUnique as any).mockImplementation(
      (args: any) =>
        args.where.pubkey === ownerPubkey
          ? Promise.resolve({
              user: { id: 'u2', pubkey: ownerPubkey, role: 'USER' }
            } as any)
          : args.where.pubkey === linkedTargetPubkey
            ? Promise.resolve({
                user: { id: 'uB', pubkey: linkedTargetPubkey, role: 'USER' }
              } as any)
            : Promise.resolve(null)
    )
    ;(prismaMock.user.findUnique as any).mockImplementation((args: any) =>
      args.where.id === 'uB'
        ? Promise.resolve({ id: 'uB', pubkey: linkedTargetPubkey } as any)
        : Promise.resolve(null)
    )

    // Linked-but-not-owned target -> 403
    await assertResponse(
      await put(linkedTargetPubkey, { relays: ['wss://nos.lol'] }),
      403
    )
    // Unlinked target -> 403 (same status: no existence probe)
    await assertResponse(
      await put(unlinkedPubkey, { relays: ['wss://nos.lol'] }),
      403
    )
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it('lets the owner edit by targeting their own primary hex pubkey', async () => {
    mockAuth(ownerPubkey)
    ;(prismaMock.nostrIdentity.findUnique as any).mockImplementation(
      (args: any) =>
        args.where.pubkey === ownerPubkey
          ? Promise.resolve({
              user: { id: 'u1', pubkey: ownerPubkey, role: 'USER' }
            } as any)
          : Promise.resolve(null)
    )
    ;(prismaMock.user.findUnique as any).mockImplementation((args: any) =>
      args.where.id === 'u1'
        ? Promise.resolve({ id: 'u1', pubkey: ownerPubkey } as any)
        : Promise.resolve(null)
    )
    vi.mocked(prismaMock.user.update).mockResolvedValue({ id: 'u1' } as any)

    const res = await put(ownerPubkey, { relays: ['wss://nos.lol'] })
    const body: any = await assertResponse(res, 200)
    expect(body.relays).toEqual(['wss://nos.lol'])
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          relays: JSON.stringify(['wss://nos.lol']),
          relaysUpdatedAt: expect.any(Date)
        })
      })
    )
  })

  it('lets a secondary identity of the owner edit the same account relays', async () => {
    const secondaryPubkey = 'e'.repeat(64)
    mockAuth(secondaryPubkey)
    // Secondary pubkey resolves to account u1, whose primary is ownerPubkey.
    ;(prismaMock.nostrIdentity.findUnique as any).mockImplementation(
      (args: any) =>
        args.where.pubkey === secondaryPubkey
          ? Promise.resolve({
              user: { id: 'u1', pubkey: ownerPubkey, role: 'USER' }
            } as any)
          : Promise.resolve(null)
    )
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'u1',
      pubkey: ownerPubkey
    } as any)
    vi.mocked(prismaMock.user.update).mockResolvedValue({ id: 'u1' } as any)

    const res = await put('u1', { relays: ['wss://nos.lol'] })
    await assertResponse(res, 200)
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' } })
    )
  })
})
