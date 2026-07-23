import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { secret: 'a'.repeat(48), enabled: true },
    keyVault: { secret: 'b'.repeat(48), previousSecrets: [], enabled: true },
    maintenance: { enabled: false },
    rateLimit: { enabled: false },
    requestLimits: { maxJsonSize: 102400, maxBodySize: 1048576 },
    isDevelopment: false,
    isTest: true,
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: vi.fn(() => undefined),
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: {
    public: {},
    auth: { maxRequests: 10, maxRequestsAuth: 30 },
    sensitive: { maxRequests: 5, maxRequestsAuth: 20 },
  },
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: new Proxy(
    {},
    { get: (_t, key) => `user.${String(key).toLowerCase()}` }
  ),
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() }),
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  resolveAccountByPubkey: vi.fn(),
}))

vi.mock('@/lib/account/merge', () => ({
  linkPubkeyToAccount: vi.fn(),
}))

vi.mock('@/lib/user', () => ({
  createNewUser: vi.fn(),
}))

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async () => ({
    challenge: 'test-challenge',
    rp: { id: 'localhost', name: 'LaWallet' },
  })),
  verifyRegistrationResponse: vi.fn(),
}))

// resolveRpContext reads settings; keep it off the DB.
vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ community_name: 'LaWallet' })),
}))
vi.mock('@/lib/public-url', () => ({
  resolveApiUrl: vi.fn(async () => 'http://localhost:3000'),
}))

import { POST as optionsRoute } from '@/app/api/auth/passkey/registration/options/route'
import { POST as verifyRoute } from '@/app/api/auth/passkey/registration/verify/route'
import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import { linkPubkeyToAccount } from '@/lib/account/merge'
import { createNewUser } from '@/lib/user'
import { Role } from '@/lib/auth/permissions'

const CHALLENGE = 'x'.repeat(43)

const sk = generateSecretKey()
const PUBKEY = getPublicKey(sk)

function proofFor(nonce: string, signWith = sk) {
  return JSON.parse(
    JSON.stringify(
      finalizeEvent(
        {
          kind: 22242,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['challenge', nonce]],
          content: '',
        },
        signWith
      )
    )
  )
}

const WEBAUTHN_CREDENTIAL = {
  id: 'cred-1',
  rawId: 'cred-1',
  type: 'public-key',
  response: { clientDataJSON: 'x', attestationObject: 'x' },
  clientExtensionResults: {},
}

function seedChallengeRow() {
  vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue({
    challenge: CHALLENGE,
    flow: 'REGISTER',
    userId: null,
    rpId: 'localhost',
    origin: 'http://localhost:3000',
    expiresAt: new Date(Date.now() + 60_000),
  } as any)
}

function seedVerification() {
  vi.mocked(verifyRegistrationResponse).mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'cred-1',
        publicKey: new Uint8Array([1, 2, 3]),
        counter: 0,
        transports: ['internal'],
      },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
      aaguid: 'aaguid-1',
    },
  } as any)
}

function verifyBody(overrides?: Record<string, unknown>) {
  return {
    challenge: CHALLENGE,
    credential: WEBAUTHN_CREDENTIAL,
    pubkey: PUBKEY,
    proof: proofFor(CHALLENGE),
    ...overrides,
  }
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  seedChallengeRow()
  seedVerification()
  vi.mocked(prismaMock.webAuthnChallenge.create).mockResolvedValue({} as any)
  // storeWebAuthnChallenge chains .catch on this fire-and-forget GC call.
  vi.mocked(prismaMock.webAuthnChallenge.deleteMany).mockResolvedValue({
    count: 0,
  } as any)
  vi.mocked(prismaMock.passkeyCredential.create).mockImplementation((async (
    args: any
  ) => ({
    ...args.data,
    createdAt: new Date(),
    lastUsedAt: null,
  })) as any)
  vi.mocked(createNewUser).mockResolvedValue({ id: 'new-user' } as any)
})

describe('POST /api/auth/passkey/registration/options', () => {
  it('mints options and stores a REGISTER challenge with no bound user', async () => {
    const response = await optionsRoute(
      createNextRequest('/api/auth/passkey/registration/options', {
        method: 'POST',
        body: {},
      })
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.options.challenge).toBe('test-challenge')
    expect(prismaMock.webAuthnChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ flow: 'REGISTER', userId: null }),
    })
  })
})

describe('POST /api/auth/passkey/registration/verify — signup', () => {
  it('creates the account for an unowned derived pubkey (no key custody)', async () => {
    vi.mocked(resolveAccountByPubkey).mockResolvedValue(null)

    const response = await verifyRoute(
      createNextRequest('/api/auth/passkey/registration/verify', {
        method: 'POST',
        body: verifyBody(),
      })
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.pubkey).toBe(PUBKEY)
    expect(body.credential.pubkey).toBe(PUBKEY)
    // No token, no signer key — client logs in via NIP-98.
    expect(body.token).toBeUndefined()
    expect(body.signerKey).toBeUndefined()
    expect(vi.mocked(createNewUser)).toHaveBeenCalledWith(PUBKEY)
    expect(prismaMock.managedNostrKey.create).not.toHaveBeenCalled()
    expect(prismaMock.passkeyCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'cred-1',
        userId: 'new-user',
        pubkey: PUBKEY,
      }),
    })
  })

  it('attaches the credential when the derived pubkey already has an account', async () => {
    vi.mocked(resolveAccountByPubkey).mockResolvedValue({
      id: 'existing-user',
      primaryPubkey: PUBKEY,
      authPubkey: PUBKEY,
      role: 'USER',
    } as any)

    const response = await verifyRoute(
      createNextRequest('/api/auth/passkey/registration/verify', {
        method: 'POST',
        body: verifyBody(),
      })
    )
    expect(response.status).toBe(200)
    expect(vi.mocked(createNewUser)).not.toHaveBeenCalled()
    expect(prismaMock.passkeyCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'existing-user' }),
    })
  })

  it('401s when the proof answers a different challenge', async () => {
    vi.mocked(resolveAccountByPubkey).mockResolvedValue(null)
    const response = await verifyRoute(
      createNextRequest('/api/auth/passkey/registration/verify', {
        method: 'POST',
        body: verifyBody({ proof: proofFor('another-nonce') }),
      })
    )
    expect(response.status).toBe(401)
    expect(vi.mocked(createNewUser)).not.toHaveBeenCalled()
  })

  it('401s when the proof is signed by a key other than the claimed pubkey', async () => {
    vi.mocked(resolveAccountByPubkey).mockResolvedValue(null)
    const otherSk = generateSecretKey()
    const response = await verifyRoute(
      createNextRequest('/api/auth/passkey/registration/verify', {
        method: 'POST',
        body: verifyBody({ proof: proofFor(CHALLENGE, otherSk) }),
      })
    )
    expect(response.status).toBe(401)
  })

  it('401s on challenge replay (row already consumed)', async () => {
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockRejectedValue(
      new Error('not found')
    )
    const response = await verifyRoute(
      createNextRequest('/api/auth/passkey/registration/verify', {
        method: 'POST',
        body: verifyBody(),
      })
    )
    expect(response.status).toBe(401)
  })

  it('409s on a duplicate credential id', async () => {
    vi.mocked(resolveAccountByPubkey).mockResolvedValue(null)
    vi.mocked(prismaMock.passkeyCredential.create).mockRejectedValue({
      code: 'P2002',
    })
    const response = await verifyRoute(
      createNextRequest('/api/auth/passkey/registration/verify', {
        method: 'POST',
        body: verifyBody(),
      })
    )
    expect(response.status).toBe(409)
  })
})

describe('POST /api/auth/passkey/registration/verify — add to account', () => {
  const CALLER = {
    id: 'caller-account',
    primaryPubkey: 'c'.repeat(64),
    authPubkey: 'c'.repeat(64),
    role: 'USER',
  }

  function authedRequest(body: unknown) {
    return createNextRequest('/api/auth/passkey/registration/verify', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token' },
      body,
    })
  }

  beforeEach(() => {
    vi.mocked(authenticate).mockResolvedValue({
      pubkey: CALLER.primaryPubkey,
      role: Role.USER,
      method: 'jwt',
    } as any)
  })

  it('links the derived pubkey as a secondary identity on the caller', async () => {
    vi.mocked(resolveAccountByPubkey).mockImplementation(async pk =>
      pk === CALLER.primaryPubkey ? (CALLER as any) : null
    )

    const response = await verifyRoute(authedRequest(verifyBody()))
    expect(response.status).toBe(200)
    expect(vi.mocked(linkPubkeyToAccount)).toHaveBeenCalledWith(
      CALLER.id,
      PUBKEY,
      undefined
    )
    expect(vi.mocked(createNewUser)).not.toHaveBeenCalled()
    expect(prismaMock.passkeyCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: CALLER.id, pubkey: PUBKEY }),
    })
  })

  it('409s when the derived pubkey belongs to a different account', async () => {
    vi.mocked(resolveAccountByPubkey).mockImplementation(async pk =>
      pk === CALLER.primaryPubkey
        ? (CALLER as any)
        : ({ id: 'someone-else' } as any)
    )

    const response = await verifyRoute(authedRequest(verifyBody()))
    expect(response.status).toBe(409)
    expect(vi.mocked(linkPubkeyToAccount)).not.toHaveBeenCalled()
  })

  it('does not link again when the pubkey is already the caller own identity', async () => {
    vi.mocked(resolveAccountByPubkey).mockImplementation(async pk =>
      pk === CALLER.primaryPubkey || pk === PUBKEY ? (CALLER as any) : null
    )

    const response = await verifyRoute(authedRequest(verifyBody()))
    expect(response.status).toBe(200)
    expect(vi.mocked(linkPubkeyToAccount)).not.toHaveBeenCalled()
  })
})
