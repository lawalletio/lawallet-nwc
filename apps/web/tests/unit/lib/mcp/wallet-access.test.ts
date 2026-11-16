import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({ getConfig: vi.fn(() => ({})) }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}))

import { Role } from '@/lib/auth/permissions'
import { logger } from '@/lib/logger'
import { McpToolError, type McpCaller } from '@/lib/mcp/types'
import type { CatalogOperation } from '@/lib/mcp/catalog'
import {
  canUseWallet,
  guardWalletOperation,
  scopeWalletResult
} from '@/lib/mcp/wallet-access'

function caller(walletIds: string[] | null): McpCaller {
  return {
    user: { pubkey: 'p', userId: 'u1', role: Role.USER },
    scopes: new Set(['read', 'write']),
    grant: { id: 'g1', clientName: 'Claude', spendLimitSats: null, walletIds },
    authorization: 'Bearer x',
    apiUrl: 'https://wallet.example',
    request: new Request('https://wallet.example/api/mcp')
  }
}

const op = (method: string, path: string) =>
  ({ method, path }) as unknown as CatalogOperation

beforeEach(() => resetPrismaMock())

describe('canUseWallet', () => {
  it('allows everything without a restriction, only the listed ones with one', () => {
    expect(canUseWallet(caller(null), 'any')).toBe(true)
    expect(canUseWallet({ ...caller(null), grant: null }, 'any')).toBe(true)
    expect(canUseWallet(caller(['w1']), 'w1')).toBe(true)
    expect(canUseWallet(caller(['w1']), 'w2')).toBe(false)
  })
})

describe('guardWalletOperation', () => {
  it('refuses every /api/remote-wallets/{id} operation on a wallet not given', () => {
    for (const path of [
      '/api/remote-wallets/{id}',
      '/api/remote-wallets/{id}/balance',
      '/api/remote-wallets/{id}/notifications/{notificationId}'
    ]) {
      expect(() =>
        guardWalletOperation(op('GET', path), { id: 'w2' }, caller(['w1']))
      ).toThrow(McpToolError)
      expect(() =>
        guardWalletOperation(op('GET', path), { id: 'w1' }, caller(['w1']))
      ).not.toThrow()
    }
  })

  it('leaves other operations and unrestricted callers alone', () => {
    expect(() =>
      guardWalletOperation(
        op('GET', '/api/remote-wallets/forwarding-map'),
        {},
        caller(['w1'])
      )
    ).not.toThrow()
    expect(() =>
      guardWalletOperation(
        op('GET', '/api/remote-wallets/{id}'),
        { id: 'w2' },
        caller(null)
      )
    ).not.toThrow()
  })
})

describe('scopeWalletResult', () => {
  it('lists only the wallets given', async () => {
    const body = [{ id: 'w1' }, { id: 'w2' }]
    await expect(
      scopeWalletResult(op('GET', '/api/remote-wallets'), body, caller(['w2']))
    ).resolves.toEqual([{ id: 'w2' }])
    await expect(
      scopeWalletResult(op('GET', '/api/remote-wallets'), body, caller(null))
    ).resolves.toBe(body)
  })

  it('narrows the forwarding map', async () => {
    await expect(
      scopeWalletResult(
        op('GET', '/api/remote-wallets/forwarding-map'),
        { actions: [{ walletId: 'w1' }, { walletId: 'w2' }] },
        caller(['w1'])
      )
    ).resolves.toEqual({ actions: [{ walletId: 'w1' }] })
  })

  it('gives the connection a wallet it created', async () => {
    const c = caller(['w1'])
    vi.mocked(prismaMock.oAuthGrant.updateMany).mockResolvedValue({
      count: 1
    } as never)

    await scopeWalletResult(
      op('POST', '/api/remote-wallets/lncurl'),
      { id: 'new' },
      c
    )
    expect(prismaMock.oAuthGrant.updateMany).toHaveBeenCalledWith({
      where: { id: 'g1', allWallets: false, revokedAt: null },
      data: { walletIds: { push: 'new' } }
    })
    expect(canUseWallet(c, 'new')).toBe(true)
  })
})

describe('hideWalletRefs (via scopeWalletResult)', () => {
  it('drops references to wallets not given, on any route, at any depth', async () => {
    const body = [
      { username: 'a', remoteWalletId: 'w1', remoteWalletName: 'Main' },
      { username: 'b', remoteWalletId: 'w2', remoteWalletName: 'Hidden' },
      { username: 'c', nested: { remoteWalletId: 'w2' } },
      { username: 'd', remoteWalletId: null }
    ]
    await expect(
      scopeWalletResult(
        op('GET', '/api/wallet/addresses'),
        body,
        caller(['w1'])
      )
    ).resolves.toEqual([
      { username: 'a', remoteWalletId: 'w1', remoteWalletName: 'Main' },
      { username: 'b', remoteWalletId: null, remoteWalletName: null },
      { username: 'c', nested: { remoteWalletId: null } },
      { username: 'd', remoteWalletId: null }
    ])
    // The REST body itself is left untouched.
    expect(body[1].remoteWalletId).toBe('w2')
  })
})

describe('edge cases', () => {
  it('refuses a wallet operation without an id', () => {
    expect(() =>
      guardWalletOperation(
        op('GET', '/api/remote-wallets/{id}'),
        {},
        caller(['w1'])
      )
    ).toThrow(McpToolError)
  })

  it('passes through bodies of an unexpected shape', async () => {
    const c = caller(['w1'])
    await expect(
      scopeWalletResult(op('GET', '/api/remote-wallets'), { error: 'x' }, c)
    ).resolves.toEqual({ error: 'x' })
    await expect(
      scopeWalletResult(
        op('GET', '/api/remote-wallets/forwarding-map'),
        { actions: 'nope' },
        c
      )
    ).resolves.toEqual({ actions: 'nope' })
    await expect(
      scopeWalletResult(op('GET', '/api/wallet/addresses'), 'text', c)
    ).resolves.toBe('text')
  })

  it('keeps a created wallet usable in this request even if saving fails', async () => {
    const c = caller(['w1'])
    vi.mocked(prismaMock.oAuthGrant.updateMany).mockRejectedValue(
      new Error('db down')
    )
    await scopeWalletResult(
      op('POST', '/api/remote-wallets/lncurl'),
      { id: 'new' },
      c
    )
    expect(logger.warn).toHaveBeenCalledWith(
      expect.anything(),
      'mcp.wallet_access_add_failed'
    )
    expect(canUseWallet(c, 'new')).toBe(true)
  })
})
