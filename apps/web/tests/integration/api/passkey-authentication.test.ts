import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'

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
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    USER_JWT_ISSUED: 'user.jwt_issued',
    USER_AUTH_FAILED: 'user.auth_failed',
    USER_ERROR: 'user.error',
    ADDRESS_ERROR: 'address.error',
    CARD_ERROR: 'card.error',
    NWC_CONNECTION_ERROR: 'nwc.connection_error',
    INVOICE_GENERATION_FAILED: 'invoice.generation_failed',
    SERVER_DATABASE_ERROR: 'server.database_error',
    SERVER_UNHANDLED_ERROR: 'server.unhandled_error',
    PASSKEY_COUNTER_REGRESSION: 'user.passkey_counter_regression',
  },
  logActivity: { fireAndForget: vi.fn() },
}))

vi.mock('@/lib/auth/resolve-role', () => ({
  resolveRole: vi.fn(),
}))

// The real lib/auth/passkey resolveRpContext resolves the RP identity from
// resolveApiUrl + community_name — pin both so rpId/origin are deterministic.
vi.mock('@/lib/public-url', () => ({
  resolveApiUrl: vi.fn(async () => 'https://wallet.example.com'),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ community_name: 'Testland' })),
}))

import { POST as optionsPost } from '@/app/api/auth/passkey/authentication/options/route'
import { POST as verifyPost } from '@/app/api/auth/passkey/authentication/verify/route'
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { getConfig } from '@/lib/config'
import { resolveRole } from '@/lib/auth/resolve-role'
import { logActivity } from '@/lib/activity-log'
import { Role } from '@/lib/auth/permissions'
import { CEREMONY_TIMEOUT_MS, PASSKEY_SESSION_EXPIRES_IN } from '@/lib/auth/passkey'

const RP_ID = 'wallet.example.com'
const ORIGIN = 'https://wallet.example.com'
const USER_PUBKEY = 'c'.repeat(64)
const CHALLENGE = 'ch_'.padEnd(32, 'x')
const CRED_ID = 'cred-base64url-id'
const JWT_SECRET = 'a'.repeat(48)

function configEnabled() {
  vi.mocked(getConfig).mockReturnValue({
    jwt: { secret: JWT_SECRET, enabled: true },
    keyVault: { secret: 'b'.repeat(48), previousSecrets: [], enabled: true },
    rateLimit: { enabled: false },
    requestLimits: { maxJsonSize: 102400, maxBodySize: 1048576 },
    maintenance: { enabled: false },
    isDevelopment: false,
    isTest: true,
  } as any)
}

function loginChallengeRow(overrides: Record<string, unknown> = {}) {
  return {
    challenge: CHALLENGE,
    flow: 'LOGIN',
    userId: null,
    rpId: RP_ID,
    origin: ORIGIN,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

function credentialRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CRED_ID,
    userId: 'user_1',
    publicKey: Buffer.from('stored-public-key'),
    counter: BigInt(5),
    transports: '["internal"]',
    deviceType: 'multiDevice',
    backedUp: true,
    aaguid: null,
    label: 'MacBook Touch ID',
    rpId: RP_ID,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastUsedAt: null,
    user: { id: 'user_1', pubkey: USER_PUBKEY },
    ...overrides,
  }
}

function assertionBody(overrides: Record<string, unknown> = {}) {
  return {
    challenge: CHALLENGE,
    credential: {
      id: CRED_ID,
      rawId: CRED_ID,
      type: 'public-key',
      response: {
        clientDataJSON: 'client-data-json',
        authenticatorData: 'authenticator-data',
        signature: 'assertion-signature',
        userHandle: null,
      },
      clientExtensionResults: {},
    },
    ...overrides,
  }
}

function verifyRequest(body: unknown = assertionBody()) {
  return createNextRequest('/api/auth/passkey/authentication/verify', {
    method: 'POST',
    body,
  })
}

function decodeJwtPayload(token: string): any {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

/** Wires the full happy path; individual tests override what they need. */
function setupHappyVerify() {
  vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
    loginChallengeRow() as any,
  )
  vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
    credentialRow() as any,
  )
  vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
    verified: true,
    authenticationInfo: { newCounter: 6 },
  } as any)
  vi.mocked(prismaMock.passkeyCredential.update).mockResolvedValue({} as any)
  vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue({
    userId: 'user_1',
    ciphertext: Buffer.from('sealed'),
    exportedAt: null,
  } as any)
  vi.mocked(resolveRole).mockResolvedValue(Role.USER)
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  configEnabled()
})

describe('POST /api/auth/passkey/authentication/options', () => {
  it('returns username-less assertion options and stores a LOGIN challenge', async () => {
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({
      challenge: 'minted-options-challenge',
      timeout: CEREMONY_TIMEOUT_MS,
      rpId: RP_ID,
      userVerification: 'required',
    } as any)
    vi.mocked(prismaMock.webAuthnChallenge.create).mockResolvedValue({} as any)
    vi.mocked(prismaMock.webAuthnChallenge.deleteMany).mockResolvedValue({
      count: 0,
    } as any)

    const req = createNextRequest('/api/auth/passkey/authentication/options', {
      method: 'POST',
      body: {},
    })
    const res = await optionsPost(req)
    const body: any = await assertResponse(res, 200)

    expect(body.options.challenge).toBe('minted-options-challenge')

    // Discoverable-credential login: empty allowCredentials, UV required.
    expect(generateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: RP_ID,
      userVerification: 'required',
      allowCredentials: [],
      timeout: CEREMONY_TIMEOUT_MS,
    })

    // The challenge row is persisted unbound to any user (LOGIN flow).
    expect(prismaMock.webAuthnChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        challenge: 'minted-options-challenge',
        flow: 'LOGIN',
        userId: null,
        rpId: RP_ID,
        origin: ORIGIN,
      }),
    })
  })

  it('returns 500 when JWT is not configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: false, secret: undefined },
      maintenance: { enabled: false },
    } as any)

    const req = createNextRequest('/api/auth/passkey/authentication/options', {
      method: 'POST',
      body: {},
    })
    const res = await optionsPost(req)
    expect(res.status).toBe(500)
    expect(generateAuthenticationOptions).not.toHaveBeenCalled()
  })
})

describe('POST /api/auth/passkey/authentication/verify', () => {
  it('logs in a managed-custody user and mints a passkey session JWT', async () => {
    setupHappyVerify()

    const res = await verifyPost(verifyRequest())
    const body: any = await assertResponse(res, 200)

    expect(body.type).toBe('Bearer')
    expect(body.expiresIn).toBe(PASSKEY_SESSION_EXPIRES_IN)
    expect(body.pubkey).toBe(USER_PUBKEY)
    expect(body.custody).toBe('managed')

    // The session JWT carries the passkey-specific claims.
    const payload = decodeJwtPayload(body.token)
    expect(payload.pubkey).toBe(USER_PUBKEY)
    // Multi-pubkey accounts: the session's userId claim is the ACCOUNT id,
    // not the pubkey.
    expect(payload.userId).toBe('user_1')
    expect(payload.role).toBe(Role.USER)
    expect(payload.amr).toEqual(['webauthn'])
    expect(payload.cred).toBe(CRED_ID)
    expect(payload.custody).toBe('managed')
    expect(payload.auth_time).toBeTypeOf('number')
    expect(Math.abs(payload.auth_time - Date.now() / 1000)).toBeLessThan(30)

    // Verification ran against the stored challenge binding and credential.
    expect(verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: CHALLENGE,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
        credential: expect.objectContaining({ id: CRED_ID, counter: 5 }),
      }),
    )

    // Counter advanced and lastUsedAt touched.
    expect(prismaMock.passkeyCredential.update).toHaveBeenCalledWith({
      where: { id: CRED_ID },
      data: { counter: BigInt(6), lastUsedAt: expect.any(Date) },
    })

    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.jwt_issued',
        userId: 'user_1',
        metadata: expect.objectContaining({ method: 'passkey', role: Role.USER }),
      }),
    )
  })

  it('reports linked custody when the account has no managed key', async () => {
    setupHappyVerify()
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(null)

    const res = await verifyPost(verifyRequest())
    const body: any = await assertResponse(res, 200)

    expect(body.custody).toBe('linked')
    expect(decodeJwtPayload(body.token).custody).toBe('linked')
  })

  it('returns the exact same 401 for unknown credential and failed signature (no oracle)', async () => {
    // Attempt A: credential id not in the database.
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      loginChallengeRow() as any,
    )
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(null)

    const unknownRes = await verifyPost(verifyRequest())
    expect(unknownRes.status).toBe(401)
    const unknownBody: any = await unknownRes.json()

    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.auth_failed',
        level: 'WARN',
        metadata: expect.objectContaining({
          method: 'passkey',
          reason: 'unknown_credential',
        }),
      }),
    )

    // Attempt B: credential exists but the assertion verification throws.
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      credentialRow() as any,
    )
    vi.mocked(verifyAuthenticationResponse).mockRejectedValue(
      new Error('signature mismatch'),
    )

    const badSigRes = await verifyPost(verifyRequest())
    expect(badSigRes.status).toBe(401)
    const badSigBody: any = await badSigRes.json()

    // Identical generic message — an attacker cannot distinguish the cases.
    expect(unknownBody.error.message).toBe('Passkey verification failed')
    expect(badSigBody.error.message).toBe(unknownBody.error.message)
    expect(prismaMock.passkeyCredential.update).not.toHaveBeenCalled()
  })

  it('rejects an unverified assertion without touching the counter', async () => {
    setupHappyVerify()
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: false,
    } as any)

    const res = await verifyPost(verifyRequest())
    expect(res.status).toBe(401)
    const body: any = await res.json()
    expect(body.error.message).toBe('Passkey verification failed')
    expect(prismaMock.passkeyCredential.update).not.toHaveBeenCalled()
  })

  it('detects a signature counter regression and rejects without updating', async () => {
    setupHappyVerify()
    // Stored counter 5, authenticator reports 5 again — clone suspicion.
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 5 },
    } as any)

    const res = await verifyPost(verifyRequest())
    expect(res.status).toBe(401)
    const body: any = await res.json()
    expect(body.error.message).toBe('Passkey verification failed')

    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.passkey_counter_regression',
        level: 'WARN',
        userId: 'user_1',
        metadata: { credentialId: CRED_ID, stored: 5, newCounter: 5 },
      }),
    )
    expect(prismaMock.passkeyCredential.update).not.toHaveBeenCalled()
  })

  it('accepts zero-counter platform passkeys (stored 0, new 0)', async () => {
    setupHappyVerify()
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      credentialRow({ counter: BigInt(0) }) as any,
    )
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 0 },
    } as any)

    const res = await verifyPost(verifyRequest())
    const body: any = await assertResponse(res, 200)

    expect(body.custody).toBe('managed')
    expect(prismaMock.passkeyCredential.update).toHaveBeenCalledWith({
      where: { id: CRED_ID },
      data: { counter: BigInt(0), lastUsedAt: expect.any(Date) },
    })
  })

  it('rejects a challenge minted for a different flow', async () => {
    setupHappyVerify()
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      loginChallengeRow({ flow: 'REGISTER' }) as any,
    )

    const res = await verifyPost(verifyRequest())
    expect(res.status).toBe(401)
    const body: any = await res.json()
    expect(body.error.message).toBe('Passkey verification failed')

    // Rejected before any credential lookup or WebAuthn work.
    expect(prismaMock.passkeyCredential.findUnique).not.toHaveBeenCalled()
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
  })

  it('rejects an unknown or already-consumed challenge', async () => {
    setupHappyVerify()
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockRejectedValue(
      new Error('Record to delete does not exist'),
    )

    const res = await verifyPost(verifyRequest())
    expect(res.status).toBe(401)
    const body: any = await res.json()
    expect(body.error.message).toBe('Passkey verification failed')
  })

  it('embeds the resolved role and its permissions in the session JWT', async () => {
    setupHappyVerify()
    vi.mocked(resolveRole).mockResolvedValue(Role.ADMIN)

    const res = await verifyPost(verifyRequest())
    const body: any = await assertResponse(res, 200)

    const payload = decodeJwtPayload(body.token)
    expect(payload.role).toBe(Role.ADMIN)
    expect(payload.permissions).toContain('settings:write')
    expect(resolveRole).toHaveBeenCalledWith(USER_PUBKEY)
  })

  it('returns 500 when JWT is not configured', async () => {
    vi.mocked(getConfig).mockReturnValue({
      jwt: { enabled: true, secret: undefined },
      maintenance: { enabled: false },
    } as any)

    const res = await verifyPost(verifyRequest())
    expect(res.status).toBe(500)
    expect(prismaMock.webAuthnChallenge.delete).not.toHaveBeenCalled()
  })
})
