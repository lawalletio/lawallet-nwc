import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn
}))

vi.mock('@/lib/events/event-bus', () => ({
  eventBus: { emit: vi.fn() }
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: { ADDRESS_CREATED: 'ADDRESS_CREATED' },
  logActivity: { fireAndForget: vi.fn() }
}))

vi.mock('@/lib/wallet/primary-wallet', () => ({
  derivePrimaryWallet: vi.fn(() => null),
  findInitialPrimaryWalletCandidate: vi.fn(async () => null),
  getPrimaryRemoteWalletForUser: vi.fn(async () => null),
  syncPrimaryRemoteWalletFlag: vi.fn()
}))

vi.mock('@/lib/wallet/default-address-mode', () => ({
  resolveDefaultAddressRouting: vi.fn(async () => ({
    mode: 'IDLE',
    remoteWalletId: null
  }))
}))

import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createLightningAddressForUser } from '@/lib/wallet/create-address'
import { ConflictError } from '@/types/server/errors'
import { logActivity } from '@/lib/activity-log'

const address = (overrides: Record<string, unknown> = {}) => ({
  username: 'alice',
  userId: 'user-1',
  mode: 'IDLE',
  redirect: null,
  remoteWalletId: null,
  remoteWallet: null,
  isPrimary: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides
})

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('createLightningAddressForUser', () => {
  it('rejects a username that already exists', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(
      address() as any
    )

    await expect(
      createLightningAddressForUser({ userId: 'user-1', username: 'alice' })
    ).rejects.toThrow(ConflictError)
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('turns a concurrent-insert P2002 into a 409 rather than a 500', async () => {
    // Two callers clear the pre-check and race to the insert; the unique
    // index rejects the loser.
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.lightningAddress.count).mockResolvedValue(0)
    vi.mocked(prismaMock.$transaction).mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    )

    const error = await createLightningAddressForUser({
      userId: 'user-1',
      username: 'alice'
    }).catch(e => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect(error.statusCode).toBe(409)
  })

  it('records the provisioning admin in the activity log', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.lightningAddress.count).mockResolvedValue(0)
    vi.mocked(prismaMock.$transaction).mockResolvedValue(address() as any)

    await createLightningAddressForUser({
      userId: 'user-1',
      username: 'alice',
      provisionedBy: 'f'.repeat(64)
    })

    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('provisioned'),
        metadata: expect.objectContaining({ provisionedBy: 'f'.repeat(64) })
      })
    )
  })

  it('omits the provisioning marker for ordinary self-service creation', async () => {
    vi.mocked(prismaMock.lightningAddress.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.lightningAddress.count).mockResolvedValue(0)
    vi.mocked(prismaMock.$transaction).mockResolvedValue(address() as any)

    await createLightningAddressForUser({ userId: 'user-1', username: 'alice' })

    const call = vi.mocked(logActivity.fireAndForget).mock.calls[0][0]
    expect(call.message).toContain('created')
    expect(call.metadata).not.toHaveProperty('provisionedBy')
  })
})
