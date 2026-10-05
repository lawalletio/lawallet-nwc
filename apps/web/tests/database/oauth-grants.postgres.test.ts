import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@/lib/generated/prisma'
import { createPrismaClient } from '@/lib/create-prisma-client'
import type { OAuthScope } from '@/lib/oauth/constants'

const databaseUrl = process.env.CARD_PAYMENT_TEST_DATABASE_URL
const databaseName = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''
const runDatabaseTests = !!databaseUrl && /(?:_e2e|_test)$/.test(databaseName)

vi.mock('@/lib/config', () => ({
  getConfig: () => ({ logLevel: 'silent', maintenance: { enabled: false } })
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    OAUTH_GRANT_CREATED: 'user.oauth_grant_created',
    OAUTH_GRANT_REVOKED: 'user.oauth_grant_revoked'
  },
  logActivity: { fireAndForget: vi.fn() }
}))

type OAuth = typeof import('@/lib/oauth/grants') &
  typeof import('@/lib/oauth/access-token') &
  typeof import('@/lib/oauth/clients')

const RESOURCE = 'https://wallet.example/api/mcp'
const OTHER_RESOURCE = 'https://other.example/api/mcp'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex')

/** Settles concurrent calls and asserts that exactly one of them succeeded. */
async function oneWinner<T>(calls: Promise<T>[]) {
  const results = await Promise.allSettled(calls)
  const won = results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))
  const losers = results.flatMap(r =>
    r.status === 'rejected' ? [r.reason] : []
  )
  expect(won).toHaveLength(1)
  return { winner: won[0], losers }
}

describe.skipIf(!runDatabaseTests)('OAuth grants against PostgreSQL', () => {
  let prisma: PrismaClient
  let oauth: OAuth
  const suffix = randomUUID()
  const userId = `oauth-user-${suffix}`
  /** A second account, so listActiveGrants sees only its own grants. */
  const listerId = `oauth-lister-${suffix}`
  const pubkey = randomBytes(32).toString('hex')
  const clientIds: string[] = []

  beforeAll(async () => {
    if (!databaseUrl || !runDatabaseTests) return
    prisma = createPrismaClient(databaseUrl)
    vi.resetModules()
    vi.doMock('@/lib/prisma', () => ({ prisma }))
    oauth = {
      ...(await import('@/lib/oauth/grants')),
      ...(await import('@/lib/oauth/access-token')),
      ...(await import('@/lib/oauth/clients'))
    }

    await prisma.user.createMany({
      data: [
        { id: userId, pubkey },
        { id: listerId, pubkey: randomBytes(32).toString('hex') }
      ]
    })
  })

  afterAll(async () => {
    if (!databaseUrl || !runDatabaseTests || !prisma) return
    await prisma.oAuthGrant.deleteMany({
      where: { userId: { in: [userId, listerId] } }
    })
    await prisma.oAuthClient.deleteMany({ where: { id: { in: clientIds } } })
    await prisma.user.deleteMany({ where: { id: { in: [userId, listerId] } } })
    await prisma.$disconnect()
    vi.doUnmock('@/lib/prisma')
  })

  async function register(name = 'Claude') {
    const client = await oauth.registerClient({
      redirect_uris: [REDIRECT],
      client_name: name
    })
    clientIds.push(client.client_id)
    return client
  }

  /** Consent with a fresh PKCE pair; `exchange` redeems the code. */
  async function authorize(
    clientId: string,
    options: {
      user?: string
      scopes?: OAuthScope[]
      spendLimitSats?: number | null
    } = {}
  ) {
    const { user = userId, scopes = ['read', 'write'] } = options
    const verifier = randomBytes(32).toString('base64url')
    const code = await oauth.createAuthorizationGrant({
      userId: user,
      client: { id: clientId, name: 'Claude' },
      redirectUri: REDIRECT,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      resource: RESOURCE,
      scopes,
      spendLimitSats: options.spendLimitSats ?? null
    })
    const exchange = () =>
      oauth.exchangeAuthorizationCode({
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource: RESOURCE
      })
    return { code, exchange }
  }

  /** A connected app: registered, authorized and exchanged. */
  async function connect(name?: string, user = userId) {
    const { client_id: clientId } = await register(name)
    const tokens = await (await authorize(clientId, { user })).exchange()
    return { clientId, tokens }
  }

  const grantOf = (clientId: string) =>
    prisma.oAuthGrant.findFirstOrThrow({
      where: { clientId },
      orderBy: { createdAt: 'desc' }
    })

  it('registers, authorizes, exchanges and verifies on the real tables', async () => {
    const client = await register('Claude')
    expect(
      await prisma.oAuthClient.findUnique({ where: { id: client.client_id } })
    ).toMatchObject({ name: 'Claude', redirectUris: [REDIRECT] })

    const { code, exchange } = await authorize(client.client_id, {
      scopes: ['read', 'write', 'spend'],
      spendLimitSats: 5000
    })
    const tokens = await exchange()

    expect(tokens).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read write spend'
    })
    // Only SHA-256 hashes of the credentials are stored.
    const grant = await grantOf(client.client_id)
    expect(grant).toMatchObject({
      userId,
      scopes: ['read', 'write', 'spend'],
      spendLimitSats: 5000,
      resource: RESOURCE,
      redirectUri: REDIRECT,
      codeHash: sha256(code),
      accessTokenHash: sha256(tokens.access_token),
      refreshTokenHash: sha256(tokens.refresh_token),
      revokedAt: null
    })
    expect(grant.codeUsedAt).toBeInstanceOf(Date)

    await expect(
      oauth.verifyAccessToken(tokens.access_token, RESOURCE)
    ).resolves.toEqual({
      grantId: grant.id,
      clientId: client.client_id,
      clientName: 'Claude',
      userId,
      pubkey,
      scopes: ['read', 'write', 'spend'],
      spendLimitSats: 5000
    })
    await expect(
      oauth.verifyAccessToken(tokens.access_token, OTHER_RESOURCE)
    ).rejects.toThrow('Access token was issued for a different resource')
    // The first use is stamped by a background conditional update.
    await vi.waitFor(async () => {
      expect((await grantOf(client.client_id)).lastUsedAt).toBeInstanceOf(Date)
    })
  })

  it('lets one of two simultaneous exchanges of a code win, then revokes the grant as a replay', async () => {
    const { client_id: clientId } = await register()
    const { exchange } = await authorize(clientId)

    const { winner, losers } = await oneWinner([exchange(), exchange()])

    expect(losers).toMatchObject([{ code: 'invalid_grant' }])
    expect((await grantOf(clientId)).revokedAt).toBeInstanceOf(Date)
    await expect(
      oauth.verifyAccessToken(winner.access_token, RESOURCE)
    ).rejects.toThrow('Access token has been revoked')
    await expect(
      oauth.refreshAccessToken({
        refresh_token: winner.refresh_token,
        client_id: clientId
      })
    ).rejects.toMatchObject({ code: 'invalid_grant' })
  })

  it('rotates a refresh token once when it is presented twice at the same moment', async () => {
    const { clientId, tokens } = await connect()
    const refresh = () =>
      oauth.refreshAccessToken({
        refresh_token: tokens.refresh_token,
        client_id: clientId,
        resource: RESOURCE
      })

    const { winner, losers } = await oneWinner([refresh(), refresh()])

    expect(losers).toMatchObject([{ code: 'invalid_grant' }])
    await expect(
      oauth.verifyAccessToken(tokens.access_token, RESOURCE)
    ).rejects.toThrow('Unknown access token')
    await expect(
      oauth.verifyAccessToken(winner.access_token, RESOURCE)
    ).resolves.toMatchObject({ clientId, userId })
    expect(await grantOf(clientId)).toMatchObject({
      revokedAt: null,
      accessTokenHash: sha256(winner.access_token),
      refreshTokenHash: sha256(winner.refresh_token)
    })
  })

  it('revokes the earlier grant when the account authorizes the same client again', async () => {
    const { clientId, tokens } = await connect()
    const earlier = await grantOf(clientId)

    // Asserted once the new code is exchanged: the revocation may happen at
    // consent or at exchange, but never later than the new tokens.
    const fresh = await (await authorize(clientId)).exchange()

    const grants = await prisma.oAuthGrant.findMany({
      where: { clientId, userId }
    })
    expect(grants).toHaveLength(2)
    expect(grants.find(g => g.id === earlier.id)?.revokedAt).toBeInstanceOf(
      Date
    )
    expect(grants.filter(g => g.revokedAt === null)).toHaveLength(1)
    await expect(
      oauth.verifyAccessToken(tokens.access_token, RESOURCE)
    ).rejects.toThrow('Access token has been revoked')
    await expect(
      oauth.verifyAccessToken(fresh.access_token, RESOURCE)
    ).resolves.toMatchObject({ clientId })
  })

  it('revokes a grant by its access or its refresh token, and ignores unknown tokens', async () => {
    const byAccess = await connect('By access token')
    const byRefresh = await connect('By refresh token')
    const bystander = await connect('Bystander')

    await oauth.revokeToken(byAccess.tokens.access_token)
    await oauth.revokeToken(byRefresh.tokens.refresh_token)

    for (const { clientId, tokens } of [byAccess, byRefresh]) {
      expect((await grantOf(clientId)).revokedAt).toBeInstanceOf(Date)
      await expect(
        oauth.verifyAccessToken(tokens.access_token, RESOURCE)
      ).rejects.toThrow('Access token has been revoked')
      await expect(
        oauth.refreshAccessToken({
          refresh_token: tokens.refresh_token,
          client_id: clientId
        })
      ).rejects.toMatchObject({ code: 'invalid_grant' })
    }

    const accountGrants = () =>
      prisma.oAuthGrant.findMany({
        where: { userId },
        select: {
          id: true,
          revokedAt: true,
          accessTokenHash: true,
          refreshTokenHash: true
        },
        orderBy: { id: 'asc' }
      })
    const before = await accountGrants()
    await oauth.revokeToken(`lwat_${randomBytes(32).toString('base64url')}`)
    await oauth.revokeToken(`lwrt_${randomBytes(32).toString('base64url')}`)
    expect(await accountGrants()).toEqual(before)
    await expect(
      oauth.verifyAccessToken(bystander.tokens.access_token, RESOURCE)
    ).resolves.toMatchObject({ clientId: bystander.clientId })
  })

  it('prunes abandoned clients and stale consents, and keeps whatever a grant anchors', async () => {
    const now = Date.now()
    const monthAgo = new Date(now - 31 * DAY_MS)
    const id = (name: string) => `oauth-prune-${name}-${suffix}`
    const clients = {
      abandoned: { createdAt: monthAgo },
      anchored: { createdAt: monthAgo },
      unused: {},
      consenting: {}
    }
    await prisma.oAuthClient.createMany({
      data: Object.entries(clients).map(([name, data]) => ({
        id: id(name),
        name,
        redirectUris: [REDIRECT],
        ...data
      }))
    })
    clientIds.push(...Object.keys(clients).map(id))
    const grants = {
      // Revoked long ago; still anchors its old client and its ledger.
      revoked: {
        clientId: id('anchored'),
        codeUsedAt: monthAgo,
        revokedAt: monthAgo
      },
      // Consent never redeemed; the code expired more than a day ago.
      'stale-consent': {
        clientId: id('consenting'),
        codeExpiresAt: new Date(now - DAY_MS - HOUR_MS)
      },
      'recent-consent': {
        clientId: id('consenting'),
        codeExpiresAt: new Date(now - HOUR_MS)
      },
      exchanged: {
        clientId: id('consenting'),
        codeUsedAt: monthAgo,
        codeExpiresAt: monthAgo
      }
    }
    await prisma.oAuthGrant.createMany({
      data: Object.entries(grants).map(([name, data]) => ({
        id: id(name),
        userId,
        scopes: ['read'],
        resource: RESOURCE,
        ...data
      }))
    })

    await oauth.pruneStaleOAuthRecords()

    const clientsLeft = await prisma.oAuthClient.findMany({
      where: { id: { in: Object.keys(clients).map(id) } },
      select: { id: true }
    })
    expect(clientsLeft.map(c => c.id).sort()).toEqual(
      ['anchored', 'consenting', 'unused'].map(id).sort()
    )
    const grantsLeft = await prisma.oAuthGrant.findMany({
      where: { id: { in: Object.keys(grants).map(id) } },
      select: { id: true }
    })
    expect(grantsLeft.map(g => g.id).sort()).toEqual(
      ['exchanged', 'recent-consent', 'revoked'].map(id).sort()
    )
  })

  it('lists only exchanged, unrevoked, unexpired grants', async () => {
    const active = await connect('Active', listerId)
    const revoked = await connect('Revoked', listerId)
    const expired = await connect('Expired', listerId)
    const { client_id: pendingClientId } = await register('Pending')
    await authorize(pendingClientId, { user: listerId })
    await oauth.revokeToken(revoked.tokens.access_token)
    const past = new Date(Date.now() - 1000)
    await prisma.oAuthGrant.updateMany({
      where: { clientId: expired.clientId },
      data: { accessExpiresAt: past, refreshExpiresAt: past }
    })

    const grant = await grantOf(active.clientId)
    expect(await oauth.listActiveGrants(listerId)).toEqual([
      {
        id: grant.id,
        clientName: 'Active',
        scopes: ['read', 'write'],
        spendLimitSats: null,
        createdAt: grant.createdAt.toISOString(),
        lastUsedAt: null
      }
    ])
    expect(await prisma.oAuthGrant.count({ where: { userId: listerId } })).toBe(
      4
    )
  })
})
