import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
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

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn(),
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: {
    public: {},
    auth: { maxRequests: 10, maxRequestsAuth: 30 },
    sensitive: { maxRequests: 5, maxRequestsAuth: 20 },
  },
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn(),
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    SIGNER_KEY_FETCHED: 'user.signer_key_fetched',
    NSEC_EXPORTED: 'user.nsec_exported',
    PASSKEY_COUNTER_REGRESSION: 'user.passkey_counter_regression',
    USER_AUTH_FAILED: 'user.auth_failed',
    USER_ERROR: 'user.error',
    ADDRESS_ERROR: 'address.error',
    CARD_ERROR: 'card.error',
    NWC_CONNECTION_ERROR: 'nwc.connection_error',
    INVOICE_GENERATION_FAILED: 'invoice.generation_failed',
    SERVER_UNHANDLED_ERROR: 'server.unhandled_error',
    SERVER_DATABASE_ERROR: 'server.database_error',
  },
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() }),
}))

vi.mock('@/lib/auth/key-vault', () => {
  class VaultDecryptError extends Error {
    constructor(message = 'Key vault decryption failed') {
      super(message)
      this.name = 'VaultDecryptError'
    }
  }
  return {
    VaultDecryptError,
    decryptNsec: vi.fn(),
    encryptNsec: vi.fn(),
    isVaultConfigured: vi.fn(() => true),
  }
})

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}))

// resolveRpContext (real, from lib/auth/passkey) resolves via these two.
vi.mock('@/lib/public-url', () => ({
  resolveApiUrl: vi.fn(async () => 'https://wallet.example.com'),
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ community_name: 'TestCommunity' })),
}))

import { GET as getSignerKey } from '@/app/api/auth/passkey/signer-key/route'
import { POST as postExportOptions } from '@/app/api/auth/passkey/nsec/export/options/route'
import { POST as postExport } from '@/app/api/auth/passkey/nsec/export/route'
import { getConfig } from '@/lib/config'
import { authenticate } from '@/lib/auth/unified-auth'
import { decryptNsec, VaultDecryptError } from '@/lib/auth/key-vault'
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import { logActivity } from '@/lib/activity-log'
import { hexToNsec } from '@/lib/nostr'

const JWT_SECRET = 'a'.repeat(48)
const USER_PUBKEY = 'f'.repeat(64)
const OTHER_PUBKEY = 'e'.repeat(64)
const USER_ID = 'user_1'
const CRED_ID = 'cred_base64url_1'
const PRIVKEY_HEX = 'ab'.repeat(32)

function baseConfig() {
  return {
    jwt: { enabled: true, secret: JWT_SECRET },
    keyVault: { enabled: true, secret: 'b'.repeat(48), previousSecrets: [] },
    rateLimit: { enabled: false },
    requestLimits: { maxJsonSize: 102400, maxBodySize: 1048576 },
    maintenance: { enabled: false },
    isDevelopment: false,
    isTest: true,
  } as any
}

function mintToken(claims: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      userId: USER_PUBKEY,
      pubkey: USER_PUBKEY,
      role: 'USER',
      permissions: [],
      ...claims,
    },
    JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '1h',
      issuer: 'lawallet-nwc',
      audience: 'lawallet-users',
    },
  )
}

function passkeyToken(claims: Record<string, unknown> = {}) {
  return mintToken({
    amr: ['webauthn'],
    cred: CRED_ID,
    custody: 'managed',
    auth_time: Math.floor(Date.now() / 1000),
    ...claims,
  })
}

function credentialRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CRED_ID,
    userId: USER_ID,
    publicKey: Buffer.from('stored-public-key'),
    counter: BigInt(5),
    transports: JSON.stringify(['internal']),
    deviceType: 'multiDevice',
    backedUp: true,
    aaguid: null,
    label: 'My passkey',
    rpId: 'wallet.example.com',
    createdAt: new Date(),
    lastUsedAt: null,
    ...overrides,
  }
}

function managedKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER_ID,
    ciphertext: Buffer.from('encrypted-envelope'),
    exportedAt: null,
    ...overrides,
  }
}

function challengeRow(overrides: Record<string, unknown> = {}) {
  return {
    challenge: 'export-challenge-1234',
    flow: 'EXPORT',
    userId: USER_ID,
    rpId: 'wallet.example.com',
    origin: 'https://wallet.example.com',
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

const assertionCredential = {
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
}

function asUser(pubkey = USER_PUBKEY) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey,
    role: 'USER',
    method: 'jwt',
  } as any)
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  vi.mocked(getConfig).mockReturnValue(baseConfig())
})

describe('GET /api/auth/passkey/signer-key', () => {
  it('rejects a plain session JWT without passkey claims', async () => {
    const req = createNextRequest('/api/auth/passkey/signer-key', {
      headers: { authorization: `Bearer ${mintToken()}` },
    })
    const res = await getSignerKey(req)

    expect(res.status).toBe(401)
    expect(prismaMock.passkeyCredential.findUnique).not.toHaveBeenCalled()
  })

  it('rejects a device-kind token even with forged passkey claims', async () => {
    const req = createNextRequest('/api/auth/passkey/signer-key', {
      headers: { authorization: `Bearer ${passkeyToken({ kind: 'device' })}` },
    })
    const res = await getSignerKey(req)

    expect(res.status).toBe(401)
    expect(prismaMock.passkeyCredential.findUnique).not.toHaveBeenCalled()
  })

  it('rejects when the credential row no longer exists (deleted passkey = revocation)', async () => {
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/auth/passkey/signer-key', {
      headers: { authorization: `Bearer ${passkeyToken()}` },
    })
    const res = await getSignerKey(req)

    expect(res.status).toBe(401)
    expect(prismaMock.managedNostrKey.findUnique).not.toHaveBeenCalled()
  })

  it('rejects when the credential belongs to a different pubkey', async () => {
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      credentialRow({
        userId: 'other_user',
        user: { id: 'other_user', pubkey: OTHER_PUBKEY },
      }) as any,
    )
    // The session pubkey resolves to its own account — which does NOT own
    // the credential.
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      user: { id: USER_ID, pubkey: USER_PUBKEY, role: 'USER' },
    } as any)

    const req = createNextRequest('/api/auth/passkey/signer-key', {
      headers: { authorization: `Bearer ${passkeyToken()}` },
    })
    const res = await getSignerKey(req)

    expect(res.status).toBe(401)
    expect(prismaMock.managedNostrKey.findUnique).not.toHaveBeenCalled()
  })

  it('returns 404 for linked accounts without a managed key', async () => {
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      credentialRow({ user: { id: USER_ID, pubkey: USER_PUBKEY } }) as any,
    )
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      user: { id: USER_ID, pubkey: USER_PUBKEY, role: 'USER' },
    } as any)
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/auth/passkey/signer-key', {
      headers: { authorization: `Bearer ${passkeyToken()}` },
    })
    const res = await getSignerKey(req)

    expect(res.status).toBe(404)
    expect(decryptNsec).not.toHaveBeenCalled()
  })

  it('releases the decrypted signer key and logs SIGNER_KEY_FETCHED at INFO', async () => {
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      credentialRow({ user: { id: USER_ID, pubkey: USER_PUBKEY } }) as any,
    )
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      user: { id: USER_ID, pubkey: USER_PUBKEY, role: 'USER' },
    } as any)
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(
      managedKeyRow() as any,
    )
    vi.mocked(decryptNsec).mockReturnValue(PRIVKEY_HEX)

    const req = createNextRequest('/api/auth/passkey/signer-key', {
      headers: { authorization: `Bearer ${passkeyToken()}` },
    })
    const res = await getSignerKey(req)
    const body: any = await assertResponse(res, 200)

    expect(body.signerKey).toBe(PRIVKEY_HEX)
    expect(body.pubkey).toBe(USER_PUBKEY)
    expect(decryptNsec).toHaveBeenCalledWith(expect.anything(), USER_ID)
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.signer_key_fetched',
        level: 'INFO',
        userId: USER_ID,
        metadata: { credentialId: CRED_ID },
      }),
    )
  })
})

describe('POST /api/auth/passkey/nsec/export/options', () => {
  it('returns 404 when the user does not exist', async () => {
    asUser()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/auth/passkey/nsec/export/options', {
      method: 'POST',
      headers: { authorization: 'Bearer x' },
      body: {},
    })
    const res = await postExportOptions(req)

    expect(res.status).toBe(404)
  })

  it('returns 404 when the account has no managed key', async () => {
    asUser()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: USER_ID,
      pubkey: USER_PUBKEY,
      passkeyCredentials: [credentialRow()],
    } as any)
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(null)

    const req = createNextRequest('/api/auth/passkey/nsec/export/options', {
      method: 'POST',
      headers: { authorization: 'Bearer x' },
      body: {},
    })
    const res = await postExportOptions(req)

    expect(res.status).toBe(404)
    expect(generateAuthenticationOptions).not.toHaveBeenCalled()
  })

  it('returns 404 when the account has no passkeys to step up with', async () => {
    asUser()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: USER_ID,
      pubkey: USER_PUBKEY,
      passkeyCredentials: [],
    } as any)
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(
      managedKeyRow() as any,
    )

    const req = createNextRequest('/api/auth/passkey/nsec/export/options', {
      method: 'POST',
      headers: { authorization: 'Bearer x' },
      body: {},
    })
    const res = await postExportOptions(req)

    expect(res.status).toBe(404)
    expect(generateAuthenticationOptions).not.toHaveBeenCalled()
  })

  it('mints and stores an EXPORT-flow challenge scoped to the user credentials', async () => {
    asUser()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: USER_ID,
      pubkey: USER_PUBKEY,
      passkeyCredentials: [credentialRow()],
    } as any)
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(
      managedKeyRow() as any,
    )
    vi.mocked(generateAuthenticationOptions).mockResolvedValue({
      challenge: 'export-challenge-1234',
      timeout: 300000,
    } as any)
    vi.mocked(prismaMock.webAuthnChallenge.create).mockResolvedValue({} as any)
    vi.mocked(prismaMock.webAuthnChallenge.deleteMany).mockResolvedValue({
      count: 0,
    } as any)

    const req = createNextRequest('/api/auth/passkey/nsec/export/options', {
      method: 'POST',
      headers: { authorization: 'Bearer x' },
      body: {},
    })
    const res = await postExportOptions(req)
    const body: any = await assertResponse(res, 200)

    expect(body.options.challenge).toBe('export-challenge-1234')
    expect(generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: 'wallet.example.com',
        userVerification: 'required',
        allowCredentials: [{ id: CRED_ID, transports: ['internal'] }],
      }),
    )
    expect(prismaMock.webAuthnChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        challenge: 'export-challenge-1234',
        flow: 'EXPORT',
        userId: USER_ID,
        rpId: 'wallet.example.com',
        origin: 'https://wallet.example.com',
      }),
    })
  })
})

describe('POST /api/auth/passkey/nsec/export', () => {
  function exportRequest() {
    return createNextRequest('/api/auth/passkey/nsec/export', {
      method: 'POST',
      headers: { authorization: 'Bearer x' },
      body: {
        challenge: 'export-challenge-1234',
        credential: assertionCredential,
      },
    })
  }

  function existingUser() {
    asUser()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: USER_ID,
      pubkey: USER_PUBKEY,
    } as any)
  }

  it('rejects a LOGIN challenge — login ceremonies must not unlock export', async () => {
    existingUser()
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow({ flow: 'LOGIN' }) as any,
    )

    const res = await postExport(exportRequest())
    const body: any = await assertResponse(res, 401)

    expect(body.error.message).toBe('Passkey verification failed')
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
    expect(decryptNsec).not.toHaveBeenCalled()
  })

  it('rejects a credential owned by another user with the generic 401', async () => {
    existingUser()
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow() as any,
    )
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      credentialRow({ userId: 'user_2' }) as any,
    )

    const res = await postExport(exportRequest())
    const body: any = await assertResponse(res, 401)

    expect(body.error.message).toBe('Passkey verification failed')
    expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
    expect(decryptNsec).not.toHaveBeenCalled()
  })

  it('rejects and logs a signature counter regression', async () => {
    existingUser()
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow() as any,
    )
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      credentialRow({ counter: BigInt(10) }) as any,
    )
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 10 },
    } as any)

    const res = await postExport(exportRequest())
    const body: any = await assertResponse(res, 401)

    expect(body.error.message).toBe('Passkey verification failed')
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.passkey_counter_regression',
        level: 'WARN',
        userId: USER_ID,
      }),
    )
    expect(prismaMock.passkeyCredential.update).not.toHaveBeenCalled()
    expect(decryptNsec).not.toHaveBeenCalled()
  })

  it('exports the nsec, stamps exportedAt, and logs NSEC_EXPORTED at WARN', async () => {
    existingUser()
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow() as any,
    )
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      credentialRow() as any,
    )
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    } as any)
    vi.mocked(prismaMock.passkeyCredential.update).mockResolvedValue({} as any)
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(
      managedKeyRow() as any,
    )
    vi.mocked(decryptNsec).mockReturnValue(PRIVKEY_HEX)
    vi.mocked(prismaMock.managedNostrKey.update).mockResolvedValue({} as any)

    const res = await postExport(exportRequest())
    const body: any = await assertResponse(res, 200)

    expect(body.nsec).toBe(hexToNsec(PRIVKEY_HEX))
    expect(body.pubkey).toBe(USER_PUBKEY)

    // The assertion is verified against the stored challenge binding.
    expect(verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: 'export-challenge-1234',
        expectedOrigin: 'https://wallet.example.com',
        expectedRPID: 'wallet.example.com',
        requireUserVerification: true,
      }),
    )

    // Counter and lastUsedAt advance like a login.
    expect(prismaMock.passkeyCredential.update).toHaveBeenCalledWith({
      where: { id: CRED_ID },
      data: expect.objectContaining({ counter: BigInt(6) }),
    })

    // The export is stamped and loudly audited.
    expect(prismaMock.managedNostrKey.update).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      data: { exportedAt: expect.any(Date) },
    })
    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.nsec_exported',
        level: 'WARN',
        userId: USER_ID,
        metadata: { credentialId: CRED_ID },
      }),
    )
  })

  it('returns 500 when no vault secret decrypts the stored envelope', async () => {
    existingUser()
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow() as any,
    )
    vi.mocked(prismaMock.passkeyCredential.findUnique).mockResolvedValue(
      credentialRow() as any,
    )
    vi.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    } as any)
    vi.mocked(prismaMock.passkeyCredential.update).mockResolvedValue({} as any)
    vi.mocked(prismaMock.managedNostrKey.findUnique).mockResolvedValue(
      managedKeyRow() as any,
    )
    vi.mocked(decryptNsec).mockImplementation(() => {
      throw new VaultDecryptError()
    })

    const res = await postExport(exportRequest())

    expect(res.status).toBe(500)
    expect(prismaMock.managedNostrKey.update).not.toHaveBeenCalled()
    expect(logActivity.fireAndForget).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'user.nsec_exported' }),
    )
  })
})
