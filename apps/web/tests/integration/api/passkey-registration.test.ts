import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { Role } from '@/lib/auth/permissions'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: () => 'test-req',
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn(),
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: {
    auth: { maxRequests: 10, maxRequestsAuth: 30 },
    sensitive: { maxRequests: 5, maxRequestsAuth: 20 },
  },
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}))

vi.mock('@/lib/public-url', () => ({
  resolveApiUrl: vi.fn(),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(),
}))

vi.mock('@/lib/user', () => ({
  createNewUser: vi.fn(),
}))

vi.mock('@/lib/nostr', () => ({
  generatePrivateKey: vi.fn(),
  getPublicKeyFromPrivate: vi.fn(),
}))

vi.mock('@/lib/auth/resolve-role', () => ({
  resolveRole: vi.fn(),
}))

const fireAndForgetMock = vi.fn()
vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    PASSKEY_REGISTERED: 'user.passkey_registered',
    USER_AUTH_FAILED: 'user.auth_failed',
    USER_ERROR: 'user.error',
    SERVER_UNHANDLED_ERROR: 'server.unhandled_error',
    SERVER_DATABASE_ERROR: 'server.database_error',
    ADDRESS_ERROR: 'address.error',
    CARD_ERROR: 'card.error',
    NWC_CONNECTION_ERROR: 'nwc.connection_error',
    INVOICE_GENERATION_FAILED: 'invoice.generation_failed',
  },
  logActivity: { fireAndForget: (...args: unknown[]) => fireAndForgetMock(...args) },
}))

// NOTE: '@/lib/auth/passkey' and '@/lib/auth/key-vault' are intentionally NOT
// mocked — they run for real against prismaMock and the mocked config, so the
// tests exercise real challenge consumption, envelope encryption and JWT
// minting.

import { POST as optionsPost } from '@/app/api/auth/passkey/registration/options/route'
import { POST as verifyPost } from '@/app/api/auth/passkey/registration/verify/route'
import { getConfig } from '@/lib/config'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { resolveApiUrl } from '@/lib/public-url'
import { getSettings } from '@/lib/settings'
import { createNewUser } from '@/lib/user'
import { generatePrivateKey, getPublicKeyFromPrivate } from '@/lib/nostr'
import { resolveRole } from '@/lib/auth/resolve-role'

const JWT_SECRET = 'a'.repeat(48)
const USER_ID = 'user-uuid-0001'
const CHALLENGE = 'test-challenge-1234567890abcdef'
const PRIVKEY = '1f'.repeat(32)
const PUBKEY = 'f0'.repeat(32)
const CRED_ID = 'cred-abc-123'
const RP_ID = 'app.example.com'
const ORIGIN = 'https://app.example.com'

function mockConfig(overrides: Record<string, unknown> = {}) {
  vi.mocked(getConfig).mockReturnValue({
    jwt: { secret: JWT_SECRET, enabled: true },
    keyVault: { secret: 'b'.repeat(48), previousSecrets: [], enabled: true },
    rateLimit: { enabled: false },
    requestLimits: { maxJsonSize: 102400, maxBodySize: 1048576 },
    maintenance: { enabled: false },
    isDevelopment: false,
    isTest: true,
    ...overrides,
  } as any)
}

function challengeRow(overrides: Record<string, unknown> = {}) {
  return {
    challenge: CHALLENGE,
    flow: 'REGISTER',
    userId: USER_ID,
    rpId: RP_ID,
    origin: ORIGIN,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

const validCredential = () => ({
  id: CRED_ID,
  rawId: CRED_ID,
  type: 'public-key',
  response: {
    clientDataJSON: 'client-data-json',
    attestationObject: 'attestation-object',
    transports: ['internal'],
  },
  clientExtensionResults: {},
})

function mockVerified() {
  vi.mocked(verifyRegistrationResponse).mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: CRED_ID,
        publicKey: new Uint8Array([1, 2, 3, 4]),
        counter: 0,
        transports: ['internal'],
      },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
      aaguid: 'aaguid-0001',
    },
  } as any)
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  mockConfig()
  vi.mocked(resolveApiUrl).mockResolvedValue(ORIGIN)
  vi.mocked(getSettings).mockResolvedValue({ community_name: 'TestCommunity' } as any)
  vi.mocked(generatePrivateKey).mockReturnValue(PRIVKEY)
  vi.mocked(getPublicKeyFromPrivate).mockReturnValue(PUBKEY)
  vi.mocked(resolveRole).mockResolvedValue(Role.USER)
  vi.mocked(createNewUser).mockResolvedValue({ id: USER_ID, pubkey: PUBKEY } as any)
  vi.mocked(prismaMock.webAuthnChallenge.create).mockResolvedValue({} as any)
  vi.mocked(prismaMock.webAuthnChallenge.deleteMany).mockResolvedValue({ count: 0 } as any)
  vi.mocked(prismaMock.managedNostrKey.create).mockResolvedValue({} as any)
  vi.mocked(prismaMock.passkeyCredential.create).mockResolvedValue({} as any)
})

describe('POST /api/auth/passkey/registration/options', () => {
  it('returns 503 when the key vault is not configured', async () => {
    mockConfig({ keyVault: { secret: null, previousSecrets: [], enabled: false } })

    const req = createNextRequest('/api/auth/passkey/registration/options', {
      method: 'POST',
    })
    const res = await optionsPost(req)

    expect(res.status).toBe(503)
    expect(prismaMock.webAuthnChallenge.create).not.toHaveBeenCalled()
  })

  it('mints registration options and stores a REGISTER challenge', async () => {
    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: CHALLENGE,
      rp: { id: RP_ID, name: 'TestCommunity' },
    } as any)

    const req = createNextRequest('/api/auth/passkey/registration/options', {
      method: 'POST',
    })
    const res = await optionsPost(req)
    const body: any = await assertResponse(res, 200)

    expect(body.options.challenge).toBe(CHALLENGE)

    // No User row is created at options time — only the challenge.
    expect(prismaMock.user.create).not.toHaveBeenCalled()
    expect(prismaMock.webAuthnChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        challenge: CHALLENGE,
        flow: 'REGISTER',
        userId: expect.any(String),
        rpId: RP_ID,
        origin: ORIGIN,
        expiresAt: expect.any(Date),
      }),
    })

    // The ceremony is bound to the resolved RP and a resident, user-verified key.
    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: RP_ID,
        rpName: 'TestCommunity',
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required',
        },
      })
    )
  })
})

describe('POST /api/auth/passkey/registration/verify', () => {
  const makeRequest = (body: Record<string, unknown> = {}) =>
    createNextRequest('/api/auth/passkey/registration/verify', {
      method: 'POST',
      body: { challenge: CHALLENGE, credential: validCredential(), ...body },
    })

  it('creates the account, custodies the key and returns a session token', async () => {
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(challengeRow() as any)
    mockVerified()

    const res = await verifyPost(makeRequest({ label: 'MacBook Touch ID' }))
    const body: any = await assertResponse(res, 200)

    // Challenge burned exactly once.
    expect(prismaMock.webAuthnChallenge.delete).toHaveBeenCalledWith({
      where: { challenge: CHALLENGE },
    })

    // User is materialized under the pre-allocated id from the challenge row.
    expect(createNewUser).toHaveBeenCalledWith(PUBKEY, { userId: USER_ID })

    // Vaulted key + credential land in one transaction.
    expect(prismaMock.managedNostrKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: USER_ID }),
    })
    const keyArg: any = vi.mocked(prismaMock.managedNostrKey.create).mock.calls[0][0]
    expect(Buffer.isBuffer(keyArg.data.ciphertext)).toBe(true)
    // The raw private key must never be stored as-is.
    expect(keyArg.data.ciphertext.toString('hex')).not.toContain(PRIVKEY)

    expect(prismaMock.passkeyCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: CRED_ID,
        userId: USER_ID,
        counter: BigInt(0),
        transports: JSON.stringify(['internal']),
        deviceType: 'multiDevice',
        backedUp: true,
        aaguid: 'aaguid-0001',
        label: 'MacBook Touch ID',
        rpId: RP_ID,
      }),
    })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)

    // Response: session token + the one-time signer key.
    expect(body.type).toBe('Bearer')
    expect(body.expiresIn).toBe('24h')
    expect(body.pubkey).toBe(PUBKEY)
    expect(body.custody).toBe('managed')
    expect(body.signerKey).toBe(PRIVKEY)

    // Passkey session claims (real mintPasskeySessionJwt ran).
    const claims: any = jwt.decode(body.token)
    expect(claims.amr).toEqual(['webauthn'])
    expect(claims.cred).toBe(CRED_ID)
    expect(claims.custody).toBe('managed')
    expect(claims.auth_time).toEqual(expect.any(Number))
    expect(claims.pubkey).toBe(PUBKEY)
    // Multi-pubkey accounts: the session's userId claim is the ACCOUNT id,
    // not the pubkey.
    expect(claims.userId).toBe(USER_ID)
    expect(claims.role).toBe(Role.USER)
    expect(claims.iss).toBe('lawallet-nwc')
    expect(claims.aud).toBe('lawallet-users')

    // Activity log carries ids only — never key material.
    const logCall = fireAndForgetMock.mock.calls.find(
      ([arg]: any[]) => arg.event === 'user.passkey_registered'
    )
    expect(logCall).toBeDefined()
    expect(JSON.stringify(logCall![0])).not.toContain(PRIVKEY)
  })

  it('rejects a replayed (already consumed) challenge with a generic 401', async () => {
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockRejectedValue(
      Object.assign(new Error('Record not found'), { code: 'P2025' })
    )

    const res = await verifyPost(makeRequest())

    expect(res.status).toBe(401)
    const body: any = await res.json()
    expect(JSON.stringify(body)).toContain('Passkey verification failed')
    expect(createNewUser).not.toHaveBeenCalled()
  })

  it('rejects an expired challenge with 401', async () => {
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow({ expiresAt: new Date(Date.now() - 1_000) }) as any
    )
    mockVerified()

    const res = await verifyPost(makeRequest())

    expect(res.status).toBe(401)
    expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    expect(createNewUser).not.toHaveBeenCalled()
  })

  it('rejects a challenge minted for a different flow with 401', async () => {
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow({ flow: 'LOGIN' }) as any
    )
    mockVerified()

    const res = await verifyPost(makeRequest())

    expect(res.status).toBe(401)
    expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    expect(createNewUser).not.toHaveBeenCalled()
  })

  it('rejects when the authenticator response fails verification', async () => {
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(challengeRow() as any)
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({ verified: false } as any)

    const res = await verifyPost(makeRequest())

    expect(res.status).toBe(401)
    expect(createNewUser).not.toHaveBeenCalled()
  })

  it('returns 409 and rolls back the user when the credential already exists', async () => {
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(challengeRow() as any)
    mockVerified()
    vi.mocked(prismaMock.$transaction).mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    )
    vi.mocked(prismaMock.user.delete).mockResolvedValue({} as any)

    const res = await verifyPost(makeRequest())

    expect(res.status).toBe(409)
    // Best-effort rollback of the half-created account (cascade cleanup).
    expect(prismaMock.user.delete).toHaveBeenCalledWith({
      where: { id: USER_ID },
    })
  })

  it('returns 503 when the key vault is not configured', async () => {
    mockConfig({ keyVault: { secret: null, previousSecrets: [], enabled: false } })

    const res = await verifyPost(makeRequest())

    expect(res.status).toBe(503)
    expect(prismaMock.webAuthnChallenge.delete).not.toHaveBeenCalled()
  })
})
