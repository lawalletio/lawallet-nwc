import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'
import { Role } from '@/lib/auth/permissions'
import { AuthorizationError } from '@/types/server/errors'

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

vi.mock('@/lib/activity-log', async importActual => ({
  ...(await importActual<typeof import('@/lib/activity-log')>()),
  logActivity: { fireAndForget: vi.fn() }
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn(),
  authenticateWithRole: vi.fn()
}))

vi.mock('@/lib/public-url', () => ({
  resolveAddressDomain: vi.fn(async () => 'example.com')
}))

import { GET as getPoll } from '@/app/api/polls/[slug]/route'
import { PUT as putResponse } from '@/app/api/polls/[slug]/response/route'
import {
  GET as listPolls,
  POST as createPoll
} from '@/app/api/admin/polls/route'
import {
  DELETE as deletePoll,
  GET as getAdminPoll,
  PATCH as patchPoll
} from '@/app/api/admin/polls/[id]/route'
import { Prisma } from '@/lib/generated/prisma'
import { GET as getResults } from '@/app/api/admin/polls/[id]/results/route'
import { PATCH as patchVoter } from '@/app/api/admin/polls/[id]/voters/[userId]/route'
import { authenticate, authenticateWithRole } from '@/lib/auth/unified-auth'

const pubkey = 'a'.repeat(64)
const now = new Date('2026-11-16T12:00:00Z')

const poll = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  slug: 'usdt-tech',
  title: 'USDT tech',
  description: null,
  type: 'RANKING',
  options: [
    { id: 'tron', label: 'Tron' },
    { id: 'rgb', label: 'RGB' }
  ],
  allowCustom: true,
  updatable: true,
  status: 'OPEN',
  createdAt: now,
  updatedAt: now,
  ...over
})

function put(choices: unknown) {
  return putResponse(
    createNextRequest('/api/polls/usdt-tech/response', {
      method: 'PUT',
      body: { choices }
    }) as any,
    createParamsPromise({ slug: 'usdt-tech' })
  )
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(authenticate).mockResolvedValue({
    role: Role.USER,
    pubkey,
    method: 'jwt'
  } as any)
  vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
    user: { id: 'u1', pubkey, role: 'USER' }
  } as any)
})

describe('GET /api/polls/[slug]', () => {
  it('returns the poll and the caller’s response', async () => {
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue({
      ...poll(),
      responses: [{ choices: ['rgb', 'tron'], updatedAt: now }]
    } as any)
    const res = await getPoll(
      createNextRequest('/api/polls/usdt-tech') as any,
      createParamsPromise({ slug: 'usdt-tech' })
    )
    const body: any = await assertResponse(res, 200)
    expect(body.poll).toMatchObject({
      id: 'p1',
      type: 'RANKING',
      status: 'OPEN'
    })
    expect(body.poll).not.toHaveProperty('description')
    expect(body.response).toEqual({
      choices: ['rgb', 'tron'],
      updatedAt: now.toISOString()
    })
  })

  it('hides drafts behind 404', async () => {
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue({
      ...poll({ status: 'DRAFT' }),
      responses: []
    } as any)
    const res = await getPoll(
      createNextRequest('/api/polls/usdt-tech') as any,
      createParamsPromise({ slug: 'usdt-tech' })
    )
    await assertResponse(res, 404)
  })
})

describe('PUT /api/polls/[slug]/response', () => {
  it('upserts on an updatable poll', async () => {
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue(poll() as any)
    vi.mocked(prismaMock.pollResponse.upsert).mockResolvedValue({
      choices: ['rgb', 'custom:Lightning', 'tron'],
      updatedAt: now
    } as any)

    const res = await put(['rgb', 'custom: Lightning ', 'tron'])
    const body: any = await assertResponse(res, 200)
    expect(body.response.choices).toEqual(['rgb', 'custom:Lightning', 'tron'])
    expect(prismaMock.pollResponse.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { choices: ['rgb', 'custom:Lightning', 'tron'] }
      })
    )
  })

  it('locks a one-time poll after the first answer', async () => {
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue(
      poll({ updatable: false }) as any
    )
    vi.mocked(prismaMock.pollResponse.findUnique).mockResolvedValue({
      id: 'r1'
    } as any)

    const res = await put(['rgb', 'tron'])
    const body: any = await assertResponse(res, 409)
    expect(body.error.code).toBe('POLL_LOCKED')
    expect(prismaMock.pollResponse.create).not.toHaveBeenCalled()
  })

  it('creates the first answer on a one-time poll', async () => {
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue(
      poll({ updatable: false }) as any
    )
    vi.mocked(prismaMock.pollResponse.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.pollResponse.create).mockResolvedValue({
      choices: ['tron', 'rgb'],
      updatedAt: now
    } as any)
    await assertResponse(await put(['tron', 'rgb']), 200)
    expect(prismaMock.pollResponse.create).toHaveBeenCalledWith({
      data: { pollId: 'p1', userId: 'u1', choices: ['tron', 'rgb'] }
    })
  })

  it('maps a racing first submit on a one-time poll to POLL_LOCKED', async () => {
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue(
      poll({ updatable: false }) as any
    )
    vi.mocked(prismaMock.pollResponse.findUnique).mockResolvedValue(null)
    vi.mocked(prismaMock.pollResponse.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test'
      })
    )
    const body: any = await assertResponse(await put(['tron', 'rgb']), 409)
    expect(body.error.code).toBe('POLL_LOCKED')
  })

  it('404s a draft poll', async () => {
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue(
      poll({ status: 'DRAFT' }) as any
    )
    await assertResponse(await put(['tron', 'rgb']), 404)
  })

  it('rejects a closed poll', async () => {
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue(
      poll({ status: 'CLOSED' }) as any
    )
    const body: any = await assertResponse(await put(['rgb', 'tron']), 409)
    expect(body.error.code).toBe('POLL_CLOSED')
  })

  it('accepts a ranking that skips options', async () => {
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue(poll() as any)
    vi.mocked(prismaMock.pollResponse.upsert).mockResolvedValue({
      choices: ['rgb'],
      updatedAt: now
    } as any)
    const body: any = await assertResponse(await put(['rgb']), 200)
    expect(body.response.choices).toEqual(['rgb'])
  })

  it.each([[[]], [['rgb', 'rgb']], [['nope']]])(
    'rejects %j with 400',
    async choices => {
      vi.mocked(prismaMock.poll.findUnique).mockResolvedValue(poll() as any)
      await assertResponse(await put(choices), 400)
      expect(prismaMock.pollResponse.upsert).not.toHaveBeenCalled()
    }
  )
})

describe('admin polls', () => {
  it('rejects non-admins with 403', async () => {
    vi.mocked(authenticateWithRole).mockRejectedValue(new AuthorizationError())
    await assertResponse(
      await listPolls(createNextRequest('/api/admin/polls') as any),
      403
    )
    await assertResponse(
      await createPoll(
        createNextRequest('/api/admin/polls', {
          method: 'POST',
          body: { slug: 'x', title: 'X', type: 'RANKING', options: [] }
        }) as any
      ),
      403
    )
    expect(prismaMock.poll.create).not.toHaveBeenCalled()
  })

  it('lists polls with counts and creates a draft', async () => {
    vi.mocked(authenticateWithRole).mockResolvedValue({} as any)
    vi.mocked(prismaMock.poll.findMany).mockResolvedValue([
      {
        ...poll(),
        _count: { responses: 2 },
        responses: [{ updatedAt: now }]
      }
    ] as any)
    const list: any = await assertResponse(
      await listPolls(createNextRequest('/api/admin/polls') as any),
      200
    )
    expect(list[0]).toMatchObject({
      id: 'p1',
      responseCount: 2,
      lastResponseAt: now.toISOString()
    })

    vi.mocked(prismaMock.poll.create).mockResolvedValue(
      poll({ status: 'DRAFT' }) as any
    )
    const created: any = await assertResponse(
      await createPoll(
        createNextRequest('/api/admin/polls', {
          method: 'POST',
          body: {
            slug: 'usdt-tech',
            title: 'USDT tech',
            type: 'RANKING',
            options: poll().options
          }
        }) as any
      ),
      201
    )
    expect(created).toMatchObject({ status: 'DRAFT', responseCount: 0 })
    expect(prismaMock.poll.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        allowCustom: false,
        updatable: true,
        status: 'DRAFT'
      })
    })
  })

  it('gets, relabels and deletes a poll', async () => {
    vi.mocked(authenticateWithRole).mockResolvedValue({} as any)
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue({
      ...poll(),
      _count: { responses: 1 }
    } as any)
    const ctx = () => createParamsPromise({ id: 'p1' })

    const got: any = await assertResponse(
      await getAdminPoll(
        createNextRequest('/api/admin/polls/p1') as any,
        ctx()
      ),
      200
    )
    expect(got.responseCount).toBe(1)

    // Same ids, new label and order: allowed even with responses.
    const relabelled = [
      { id: 'rgb', label: 'RGB protocol' },
      { id: 'tron', label: 'Tron' }
    ]
    vi.mocked(prismaMock.poll.update).mockResolvedValue(
      poll({ options: relabelled, status: 'CLOSED' }) as any
    )
    const patched: any = await assertResponse(
      await patchPoll(
        createNextRequest('/api/admin/polls/p1', {
          method: 'PATCH',
          body: { options: relabelled, status: 'CLOSED' }
        }) as any,
        ctx()
      ),
      200
    )
    expect(patched.status).toBe('CLOSED')

    await assertResponse(
      await deletePoll(
        createNextRequest('/api/admin/polls/p1', { method: 'DELETE' }) as any,
        ctx()
      ),
      200
    )
    expect(prismaMock.poll.delete).toHaveBeenCalledWith({ where: { id: 'p1' } })
  })

  it('404s an unknown poll id', async () => {
    vi.mocked(authenticateWithRole).mockResolvedValue({} as any)
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue(null)
    await assertResponse(
      await getAdminPoll(
        createNextRequest('/api/admin/polls/nope') as any,
        createParamsPromise({ id: 'nope' })
      ),
      404
    )
  })

  it('freezes option ids once a poll has responses', async () => {
    vi.mocked(authenticateWithRole).mockResolvedValue({} as any)
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue({
      ...poll(),
      _count: { responses: 1 }
    } as any)
    const res = await patchPoll(
      createNextRequest('/api/admin/polls/p1', {
        method: 'PATCH',
        body: {
          options: [
            { id: 'tron', label: 'Tron' },
            { id: 'polygon', label: 'Polygon' }
          ]
        }
      }) as any,
      createParamsPromise({ id: 'p1' })
    )
    await assertResponse(res, 409)
    expect(prismaMock.poll.update).not.toHaveBeenCalled()
  })

  it('returns aggregated results with voter addresses', async () => {
    vi.mocked(authenticateWithRole).mockResolvedValue({} as any)
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue({
      ...poll(),
      responses: [
        {
          userId: 'u1',
          choices: ['rgb', 'tron'],
          updatedAt: now,
          user: { pubkey, lightningAddresses: [{ username: 'alice' }] }
        }
      ]
    } as any)
    const res = await getResults(
      createNextRequest('/api/admin/polls/p1/results') as any,
      createParamsPromise({ id: 'p1' })
    )
    const body: any = await assertResponse(res, 200)
    expect(body.total).toBe(1)
    expect(body.firstChoice[0]).toMatchObject({ choice: 'rgb', count: 1 })
    expect(body.voters[0]).toMatchObject({
      lightningAddress: 'alice@example.com',
      npub: expect.stringMatching(/^npub1/)
    })
  })

  it('dismisses a voter: listed, flagged, not counted', async () => {
    vi.mocked(authenticateWithRole).mockResolvedValue({} as any)
    vi.mocked(prismaMock.poll.findUnique).mockResolvedValue({
      ...poll(),
      responses: [
        {
          userId: 'u1',
          choices: ['rgb', 'tron'],
          updatedAt: now,
          dismissedAt: null,
          user: { pubkey, lightningAddresses: [] }
        },
        {
          userId: 'u2',
          choices: ['tron', 'rgb'],
          updatedAt: now,
          dismissedAt: now,
          user: { pubkey, lightningAddresses: [] }
        }
      ]
    } as any)
    const body: any = await assertResponse(
      await getResults(
        createNextRequest('/api/admin/polls/p1/results') as any,
        createParamsPromise({ id: 'p1' })
      ),
      200
    )
    expect(body).toMatchObject({ total: 1, dismissed: 1 })
    expect(body.firstChoice[0]).toMatchObject({ choice: 'rgb', count: 1 })
    expect(body.voters.find((v: any) => v.userId === 'u2').dismissed).toBe(
      true
    )
  })

  function patchVoterReq(dismissed: unknown) {
    return patchVoter(
      createNextRequest('/api/admin/polls/p1/voters/u1', {
        method: 'PATCH',
        body: { dismissed }
      }) as any,
      createParamsPromise({ id: 'p1', userId: 'u1' })
    )
  }

  it('flags a response as dismissed without bumping updatedAt', async () => {
    vi.mocked(authenticateWithRole).mockResolvedValue({} as any)
    vi.mocked(prismaMock.pollResponse.findUnique).mockResolvedValue({
      updatedAt: now
    } as any)
    const body: any = await assertResponse(await patchVoterReq(true), 200)
    expect(body).toEqual({ userId: 'u1', dismissed: true })
    expect(prismaMock.pollResponse.update).toHaveBeenCalledWith({
      where: { pollId_userId: { pollId: 'p1', userId: 'u1' } },
      data: { dismissedAt: expect.any(Date), updatedAt: now }
    })

    await assertResponse(await patchVoterReq(false), 200)
    expect(prismaMock.pollResponse.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { dismissedAt: null, updatedAt: now }
      })
    )
  })

  it('404s an unknown voter, 400s a bad body, 403s non-admins', async () => {
    vi.mocked(authenticateWithRole).mockResolvedValue({} as any)
    vi.mocked(prismaMock.pollResponse.findUnique).mockResolvedValue(null)
    await assertResponse(await patchVoterReq(true), 404)
    await assertResponse(await patchVoterReq('yes'), 400)
    vi.mocked(authenticateWithRole).mockRejectedValue(new AuthorizationError())
    await assertResponse(await patchVoterReq(true), 403)
    expect(prismaMock.pollResponse.update).not.toHaveBeenCalled()
  })
})
