import { beforeEach, describe, expect, it, vi } from 'vitest'

// logger calls getConfig at module load — mock it first.
vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ isProduction: false, logPretty: false }))
}))
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { requestContext } from '@/lib/request-context'
import {
  forgetResolvedAccounts,
  resolveAccountByPubkey,
  resolveAccountId
} from '@/lib/auth/account'
import { resolveRole } from '@/lib/auth/resolve-role'
import { logger, withRequestLogging } from '@/lib/logger'

const PK = 'a'.repeat(64)
const user = { id: 'u1', pubkey: PK, role: 'ADMIN' }

const inRequest = <T>(fn: () => Promise<T>) =>
  requestContext.run({ reqId: 'test' }, fn)

beforeEach(() => {
  resetPrismaMock()
  logger.level = 'silent'
})

describe('resolveAccountByPubkey per-request memo', () => {
  it('hits the DB once for repeated lookups in one request', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      user
    } as any)

    await inRequest(async () => {
      // authenticate() → resolveRole, then the route's own lookup
      expect(await resolveRole(PK)).toBe('ADMIN')
      expect(await resolveAccountId(PK)).toBe('u1')
      expect((await resolveAccountByPubkey(PK))?.id).toBe('u1')
    })

    expect(prismaMock.nostrIdentity.findUnique).toHaveBeenCalledOnce()
  })

  it('is scoped by withRequestLogging (every withErrorHandling route)', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      user
    } as any)
    const handler = withRequestLogging(async (_req: Request) => {
      await resolveRole(PK)
      await resolveAccountId(PK)
      return new Response('ok')
    })

    await handler(new Request('http://localhost/api/users/me'))
    await handler(new Request('http://localhost/api/users/me'))

    // once per request, not once per lookup
    expect(prismaMock.nostrIdentity.findUnique).toHaveBeenCalledTimes(2)
  })

  it('does not share the memo across requests', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      user
    } as any)

    await inRequest(() => resolveAccountByPubkey(PK))
    await inRequest(() => resolveAccountByPubkey(PK))

    expect(prismaMock.nostrIdentity.findUnique).toHaveBeenCalledTimes(2)
  })

  it('does not memoize outside a request scope', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      user
    } as any)

    await resolveAccountByPubkey(PK)
    await resolveAccountByPubkey(PK)

    expect(prismaMock.nostrIdentity.findUnique).toHaveBeenCalledTimes(2)
  })

  it('never memoizes a miss, so a user created mid-request is seen', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user } as any)
    vi.mocked(prismaMock.user.findUnique).mockResolvedValueOnce(null)

    await inRequest(async () => {
      expect(await resolveAccountByPubkey(PK)).toBeNull()
      expect((await resolveAccountByPubkey(PK))?.id).toBe('u1')
    })
  })

  it('never memoizes a failed lookup', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique)
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ user } as any)

    await inRequest(async () => {
      await expect(resolveAccountByPubkey(PK)).rejects.toThrow('db down')
      expect((await resolveAccountByPubkey(PK))?.id).toBe('u1')
    })
  })

  it('re-reads after forgetResolvedAccounts (link/merge/primary writes)', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique)
      .mockResolvedValueOnce({ user } as any)
      .mockResolvedValueOnce({ user: { ...user, id: 'u2' } } as any)

    await inRequest(async () => {
      expect((await resolveAccountByPubkey(PK))?.id).toBe('u1')
      forgetResolvedAccounts()
      expect((await resolveAccountByPubkey(PK))?.id).toBe('u2')
    })
  })
})
