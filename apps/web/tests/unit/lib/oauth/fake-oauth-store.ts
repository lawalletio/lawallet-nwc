import { vi } from 'vitest'
import { prismaMock } from '@/tests/helpers/prisma-mock'

/**
 * In-memory stand-in for the `oAuthClient` / `oAuthGrant` tables, installed
 * on the shared prisma mock. It evaluates `where` at call time, so the
 * conditional `updateMany` calls that make codes and refresh tokens single-use
 * behave as in Postgres even when two requests interleave. It also honours
 * `select`: a field the code forgot to select comes back `undefined`, exactly
 * as it would from Prisma, so a silently skipped check fails a test here.
 */
type Row = Record<string, any>

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some(c => matches(row, c))
    const value = row[key]
    if (cond === null) return value === null || value === undefined
    if (cond instanceof Date) return value?.getTime() === cond.getTime()
    if (typeof cond === 'object') {
      if ('not' in cond)
        return cond.not === null ? value != null : value !== cond.not
      if ('gt' in cond) return value != null && value > cond.gt
      if ('lt' in cond) return value != null && value < cond.lt
      throw new Error(`fake store: unsupported filter on ${key}`)
    }
    return value === cond
  })
}

function project(row: Row, select?: Row): Row {
  if (!select) return { ...row }
  const out: Row = {}
  for (const [key, spec] of Object.entries(select)) {
    if (spec === true) out[key] = row[key]
    else if (spec && typeof spec === 'object') {
      out[key] = row[key] ? project(row[key], spec.select) : null
    }
  }
  return out
}

export interface FakeOAuthStore {
  clients: Row[]
  grants: Row[]
  users: Map<string, { id: string; pubkey: string }>
}

export function installFakeOAuthStore(): FakeOAuthStore {
  const store: FakeOAuthStore = { clients: [], grants: [], users: new Map() }
  let seq = 0

  const withRelations = (grant: Row): Row => ({
    ...grant,
    client: store.clients.find(c => c.id === grant.clientId),
    user: store.users.get(grant.userId) ?? null
  })

  vi.mocked(prismaMock.oAuthClient.create).mockImplementation((async ({
    data
  }: Row) => {
    const row = { id: `client_${++seq}`, createdAt: new Date(), ...data }
    store.clients.push(row)
    return { ...row }
  }) as never)
  vi.mocked(prismaMock.oAuthClient.findUnique).mockImplementation((async ({
    where,
    select
  }: Row) => {
    const row = store.clients.find(c => matches(c, where))
    return row ? project(row, select) : null
  }) as never)
  vi.mocked(prismaMock.oAuthClient.deleteMany).mockImplementation((async ({
    where
  }: Row) => {
    const { grants: relation, ...rest } = where
    const doomed = store.clients.filter(
      c =>
        matches(c, rest) &&
        (!relation || !store.grants.some(g => g.clientId === c.id))
    )
    store.clients = store.clients.filter(c => !doomed.includes(c))
    return { count: doomed.length }
  }) as never)

  vi.mocked(prismaMock.oAuthGrant.create).mockImplementation((async ({
    data,
    select
  }: Row) => {
    const row = {
      id: `grant_${++seq}`,
      createdAt: new Date(Date.now() + seq),
      spendLimitSats: null,
      codeHash: null,
      codeChallenge: null,
      redirectUri: null,
      codeExpiresAt: null,
      codeUsedAt: null,
      accessTokenHash: null,
      accessExpiresAt: null,
      refreshTokenHash: null,
      refreshExpiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
      ...data
    }
    store.grants.push(row)
    return project(withRelations(row), select)
  }) as never)
  const findGrant = (async ({ where, select }: Row) => {
    const row = store.grants.find(g => matches(g, where))
    return row ? project(withRelations(row), select) : null
  }) as never
  vi.mocked(prismaMock.oAuthGrant.findUnique).mockImplementation(findGrant)
  vi.mocked(prismaMock.oAuthGrant.findFirst).mockImplementation(findGrant)
  vi.mocked(prismaMock.oAuthGrant.findMany).mockImplementation((async ({
    where,
    select,
    take
  }: Row) =>
    store.grants
      .filter(g => matches(g, where))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, take)
      .map(g => project(withRelations(g), select))) as never)
  vi.mocked(prismaMock.oAuthGrant.updateMany).mockImplementation((async ({
    where,
    data
  }: Row) => {
    const hits = store.grants.filter(g => matches(g, where))
    for (const grant of hits) Object.assign(grant, data)
    return { count: hits.length }
  }) as never)
  vi.mocked(prismaMock.oAuthGrant.deleteMany).mockImplementation((async ({
    where
  }: Row) => {
    const doomed = store.grants.filter(g => matches(g, where))
    store.grants = store.grants.filter(g => !doomed.includes(g))
    return { count: doomed.length }
  }) as never)

  return store
}
