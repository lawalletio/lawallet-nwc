import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({ maintenance: { enabled: false } }))
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: unknown) => fn
}))
vi.mock('@/lib/middleware/maintenance', () => ({ checkMaintenance: vi.fn() }))
vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))
vi.mock('@/lib/auth/unified-auth', () => ({ authenticate: vi.fn() }))

import { PUT } from '@/app/api/wallet/transactions/[paymentHash]/label/route'
import * as route from '@/app/api/wallet/transactions/[paymentHash]/label/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { AuthenticationError } from '@/types/server/errors'
import { Role } from '@/lib/auth/permissions'
import { GET as getTags } from '@/app/api/wallet/transaction-tags/route'
import * as tagsRoute from '@/app/api/wallet/transaction-tags/route'

const hash = 'a'.repeat(64)
const path = `/api/wallet/transactions/${hash}/label`

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: 'b'.repeat(64),
    role: Role.USER,
    method: 'jwt'
  })
  vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
    id: 'owner'
  } as never)
})

describe('private transaction label', () => {
  it('keeps a tag while another transaction uses it and omits it after the last removal', async () => {
    const assignments = new Map([
      [hash, 'Travel'],
      ['c'.repeat(64), 'Travel']
    ])
    vi.mocked(prismaMock.transactionLabel.findMany).mockImplementation(
      () =>
        Promise.resolve(
          [...new Set(assignments.values())].map(label => ({ label }))
        ) as never
    )
    vi.mocked(prismaMock.transactionLabel.deleteMany).mockImplementation(
      args => {
        assignments.delete(args!.where!.paymentHash as string)
        return Promise.resolve({ count: 1 }) as never
      }
    )
    const remove = (paymentHash: string) =>
      PUT(
        createNextRequest(path, { method: 'PUT', body: { label: '' } }),
        createParamsPromise({ paymentHash })
      )
    await remove(hash)
    expect(
      await assertResponse(
        await getTags(createNextRequest('/api/wallet/transaction-tags')),
        200
      )
    ).toEqual({ tags: ['Travel'] })
    await remove('c'.repeat(64))
    expect(
      await assertResponse(
        await getTags(createNextRequest('/api/wallet/transaction-tags')),
        200
      )
    ).toEqual({ tags: [] })
    expect(prismaMock.transactionLabel.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'owner', paymentHash: hash }
    })
    expect(tagsRoute).not.toHaveProperty('DELETE')
  })
  it('does not expose the saved-tag list without authentication', async () => {
    vi.mocked(authenticate).mockRejectedValue(
      new AuthenticationError('Unauthorized')
    )
    expect(
      (await getTags(createNextRequest('/api/wallet/transaction-tags'))).status
    ).toBe(401)
    expect(prismaMock.transactionLabel.findMany).not.toHaveBeenCalled()
  })
  it('returns an empty list when the account has no saved tags', async () => {
    vi.mocked(prismaMock.transactionLabel.findMany).mockResolvedValue([])
    expect(
      await assertResponse(
        await getTags(createNextRequest('/api/wallet/transaction-tags')),
        200
      )
    ).toEqual({ tags: [] })
  })
  it('lists the authenticated account’s saved tags without duplicates or other users’ data', async () => {
    vi.mocked(prismaMock.transactionLabel.findMany).mockResolvedValue([
      { label: 'Groceries' },
      { label: 'Travel' }
    ] as never)
    const response = await getTags(
      createNextRequest('/api/wallet/transaction-tags?userId=someone-else')
    )
    expect(await assertResponse(response, 200)).toEqual({
      tags: ['Groceries', 'Travel']
    })
    expect(prismaMock.transactionLabel.findMany).toHaveBeenCalledWith({
      where: { userId: 'owner' },
      distinct: ['label'],
      select: { label: true },
      orderBy: { label: 'asc' }
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })
  it('returns null for an unlabelled transaction without revealing other accounts', async () => {
    vi.mocked(prismaMock.transactionLabel.findUnique).mockResolvedValue(null)
    expect(
      await assertResponse(
        await route.GET(
          createNextRequest(path),
          createParamsPromise({ paymentHash: hash })
        ),
        200
      )
    ).toEqual({ label: null })
  })

  it.each(['GET', 'PUT'] as const)(
    'requires authentication for %s',
    async method => {
      vi.mocked(authenticate).mockRejectedValue(
        new AuthenticationError('Unauthorized')
      )
      const response = await route[method](
        createNextRequest(path, { method, body: { label: 'Personal' } }),
        createParamsPromise({ paymentHash: hash })
      )
      expect(response.status).toBe(401)
      expect(prismaMock.transactionLabel.findUnique).not.toHaveBeenCalled()
      expect(prismaMock.transactionLabel.upsert).not.toHaveBeenCalled()
    }
  )

  it('uses the owning account when authenticated with a secondary identity', async () => {
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      user: { id: 'linked-owner', pubkey: 'c'.repeat(64), role: 'USER' }
    } as never)
    await PUT(
      createNextRequest(path, { method: 'PUT', body: { label: 'Work' } }),
      createParamsPromise({ paymentHash: hash.toUpperCase() })
    )
    expect(prismaMock.transactionLabel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_paymentHash: { userId: 'linked-owner', paymentHash: hash }
        }
      })
    )
  })

  it.each(['x'.repeat(101), 42, null, { label: 'hidden' }])(
    'rejects invalid labels (%j)',
    async label => {
      const response = await PUT(
        createNextRequest(path, { method: 'PUT', body: { label } }),
        createParamsPromise({ paymentHash: hash })
      )
      expect(response.status).toBe(400)
      expect(prismaMock.transactionLabel.upsert).not.toHaveBeenCalled()
    }
  )

  it.each(['GET', 'PUT'] as const)(
    'rejects malformed transaction hashes for %s',
    async method => {
      const response = await route[method](
        createNextRequest(path, { method, body: { label: 'Personal' } }),
        createParamsPromise({ paymentHash: 'not-a-payment-hash' })
      )
      expect(response.status).toBe(400)
      expect(prismaMock.transactionLabel.findUnique).not.toHaveBeenCalled()
      expect(prismaMock.transactionLabel.upsert).not.toHaveBeenCalled()
    }
  )

  it('removes the caller’s label when saved empty', async () => {
    vi.mocked(prismaMock.transactionLabel.deleteMany).mockResolvedValue({
      count: 1
    })
    const response = await PUT(
      createNextRequest(path, { method: 'PUT', body: { label: '   ' } }),
      createParamsPromise({ paymentHash: hash })
    )
    expect(await assertResponse(response, 200)).toEqual({ label: null })
    expect(prismaMock.transactionLabel.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'owner', paymentHash: hash }
    })
    expect(prismaMock.transactionLabel.upsert).not.toHaveBeenCalled()
  })

  it('reloads only the caller’s persisted label, never a counterpart’s', async () => {
    expect(route).toHaveProperty('GET', expect.any(Function))
    vi.mocked(prismaMock.transactionLabel.findUnique).mockResolvedValue({
      label: 'Travel'
    } as never)
    const response = await route.GET(
      createNextRequest(`${path}?userId=someone-else`),
      createParamsPromise({ paymentHash: hash })
    )

    expect(await assertResponse(response, 200)).toEqual({ label: 'Travel' })
    expect(prismaMock.transactionLabel.findUnique).toHaveBeenCalledWith({
      where: { userId_paymentHash: { userId: 'owner', paymentHash: hash } },
      select: { label: true }
    })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('persists a normalized label only under the authenticated account', async () => {
    const response = await PUT(
      createNextRequest(path, {
        method: 'PUT',
        body: { label: '  Groceries  ', userId: 'someone-else' }
      }),
      createParamsPromise({ paymentHash: hash })
    )

    expect(await assertResponse(response, 200)).toEqual({ label: 'Groceries' })
    expect(prismaMock.transactionLabel.upsert).toHaveBeenCalledWith({
      where: { userId_paymentHash: { userId: 'owner', paymentHash: hash } },
      create: { userId: 'owner', paymentHash: hash, label: 'Groceries' },
      update: { label: 'Groceries' }
    })
  })
})
