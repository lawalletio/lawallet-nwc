import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

const authenticateMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/unified-auth', async () => {
  const { hasPermission } = await import('@/lib/auth/permissions')
  return {
    authenticate: authenticateMock,
    authHasPermission: (
      auth: { role: Parameters<typeof hasPermission>[0]; scopes?: string[] },
      permission: Parameters<typeof hasPermission>[1]
    ) =>
      auth.scopes
        ? auth.scopes.includes(permission)
        : hasPermission(auth.role, permission)
  }
})
vi.mock('@/lib/auth/account', () => ({
  resolveAccountId: vi.fn(async () => 'caller-1')
}))

import {
  loadOwnedRemoteWallet,
  loadViewableRemoteWallet
} from '@/lib/remote-wallets/owned'
import { Permission } from '@/lib/auth/permissions'

const request = new Request('http://localhost/api/remote-wallets/w1')

function walletOwnedBy(userId: string) {
  vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue({
    id: 'w1',
    userId
  } as never)
}

function callerIs(role: string, scopes?: string[]) {
  authenticateMock.mockResolvedValue({
    pubkey: 'a'.repeat(64),
    role,
    method: 'jwt',
    ...(scopes ? { scopes } : {})
  })
}

describe('remote wallet access', () => {
  beforeEach(() => {
    resetPrismaMock()
    vi.clearAllMocks()
    callerIs('USER')
  })

  it('lets the owner read their own wallet', async () => {
    walletOwnedBy('caller-1')

    await expect(loadViewableRemoteWallet('w1', request)).resolves.toMatchObject(
      { isOwner: true }
    )
    await expect(loadOwnedRemoteWallet('w1', 'caller-1')).resolves.toMatchObject(
      { id: 'w1' }
    )
  })

  it('hides somebody else’s wallet from a plain user as a 404, not a 403', async () => {
    walletOwnedBy('other-user')

    await expect(loadViewableRemoteWallet('w1', request)).rejects.toThrow(
      'Wallet not found'
    )
  })

  it('opens it read-only to an admin', async () => {
    callerIs('ADMIN')
    walletOwnedBy('other-user')

    await expect(loadViewableRemoteWallet('w1', request)).resolves.toMatchObject(
      { isOwner: false, wallet: { userId: 'other-user' } }
    )
  })

  it('still refuses that admin every mutating path', async () => {
    // The whole safety property in one line: read access widened, write access
    // did not. Mutating routes keep calling loadOwnedRemoteWallet, which has no
    // notion of a permission at all.
    callerIs('ADMIN')
    walletOwnedBy('other-user')

    await expect(loadOwnedRemoteWallet('w1', 'caller-1')).rejects.toThrow(
      'Wallet not found'
    )
  })

  it('honours a device token’s scopes over its owner’s role', async () => {
    // A narrowly-scoped ADMIN token must not inherit the full role.
    callerIs('ADMIN', ['cards:read'])
    walletOwnedBy('other-user')

    await expect(loadViewableRemoteWallet('w1', request)).rejects.toThrow(
      'Wallet not found'
    )

    callerIs('ADMIN', [Permission.REMOTE_WALLETS_READ])
    await expect(loadViewableRemoteWallet('w1', request)).resolves.toMatchObject(
      { isOwner: false }
    )
  })

  it('404s a wallet that does not exist at all', async () => {
    callerIs('ADMIN')
    vi.mocked(prismaMock.remoteWallet.findUnique).mockResolvedValue(null as never)

    await expect(loadViewableRemoteWallet('w1', request)).rejects.toThrow(
      'Wallet not found'
    )
  })
})
