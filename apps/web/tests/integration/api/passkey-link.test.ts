import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createNextRequest, assertResponse } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { AuthenticationError } from '@/types/server/errors'
import { Role } from '@/lib/auth/permissions'

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(() => ({
    jwt: { secret: 'a'.repeat(48), enabled: true },
    rateLimit: { enabled: false },
    requestLimits: { maxJsonSize: 102400, maxBodySize: 1048576 },
    maintenance: { enabled: false },
    isDevelopment: false,
    isTest: true
  }))
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
  },
  withRequestLogging: (fn: any) => fn,
  getCurrentReqId: () => 'test-req'
}))

vi.mock('@/lib/middleware/request-limits', () => ({
  checkRequestLimits: vi.fn()
}))

vi.mock('@/lib/middleware/maintenance', () => ({
  checkMaintenance: vi.fn()
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  rateLimit: vi.fn(),
  RateLimitPresets: {
    auth: { maxRequests: 10, maxRequestsAuth: 30 },
    sensitive: { maxRequests: 5, maxRequestsAuth: 20 }
  }
}))

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn()
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: {
    PASSKEY_LINKED: 'user.passkey_linked',
    USER_ERROR: 'user.error',
    ADDRESS_ERROR: 'address.error',
    CARD_ERROR: 'card.error',
    NWC_CONNECTION_ERROR: 'nwc.connection_error',
    INVOICE_GENERATION_FAILED: 'invoice.generation_failed',
    SERVER_UNHANDLED_ERROR: 'server.unhandled_error',
    SERVER_DATABASE_ERROR: 'server.database_error'
  },
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() })
}))

// The RP context resolves from the instance URL + community name settings —
// pin both so the real passkey helpers (which we intentionally do NOT mock)
// produce a deterministic rpId/origin.
vi.mock('@/lib/public-url', () => ({
  resolveApiUrl: vi.fn(async () => 'https://app.example.com')
}))

vi.mock('@/lib/settings', () => ({
  getSettings: vi.fn(async () => ({ community_name: 'TestWallet' }))
}))

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn()
}))

import { POST as optionsPost } from '@/app/api/auth/passkey/link/options/route'
import { POST as verifyPost } from '@/app/api/auth/passkey/link/verify/route'
import { authenticate } from '@/lib/auth/unified-auth'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse
} from '@simplewebauthn/server'
import { logActivity } from '@/lib/activity-log'

const PUBKEY_A = 'a'.repeat(64)
const USER_A = 'user-a'
const CHALLENGE = 'c'.repeat(32)
const RP_ID = 'app.example.com'
const ORIGIN = 'https://app.example.com'

const asUserA = () =>
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: PUBKEY_A,
    role: Role.USER,
    method: 'jwt'
  })

const challengeRow = (overrides: Record<string, unknown> = {}) => ({
  challenge: CHALLENGE,
  flow: 'LINK',
  userId: USER_A,
  rpId: RP_ID,
  origin: ORIGIN,
  expiresAt: new Date(Date.now() + 60_000),
  ...overrides
})

const validCredential = {
  id: 'cred-new',
  rawId: 'cred-new',
  type: 'public-key',
  response: {
    clientDataJSON: 'client-data-json',
    attestationObject: 'attestation-object'
  },
  clientExtensionResults: {}
}

const registrationInfo = {
  credential: {
    id: 'cred-new',
    publicKey: new Uint8Array([1, 2, 3]),
    counter: 5,
    transports: ['internal', 'hybrid']
  },
  credentialDeviceType: 'multiDevice',
  credentialBackedUp: true,
  aaguid: 'aaguid-1'
}

const createdRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'cred-new',
  userId: USER_A,
  publicKey: Buffer.from([1, 2, 3]),
  counter: BigInt(5),
  transports: '["internal","hybrid"]',
  deviceType: 'multiDevice',
  backedUp: true,
  aaguid: 'aaguid-1',
  label: null,
  rpId: RP_ID,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  lastUsedAt: null,
  ...overrides
})

function optionsReq() {
  return createNextRequest('/api/auth/passkey/link/options', {
    method: 'POST',
    headers: { authorization: 'Bearer x' },
    body: {}
  })
}

function verifyReq(body: Record<string, unknown>) {
  return createNextRequest('/api/auth/passkey/link/verify', {
    method: 'POST',
    headers: { authorization: 'Bearer x' },
    body
  })
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
  // storeWebAuthnChallenge does a fire-and-forget GC deleteMany().catch() —
  // it must return a promise or the helper throws synchronously.
  vi.mocked(prismaMock.webAuthnChallenge.deleteMany).mockResolvedValue({
    count: 0
  } as any)
  vi.mocked(prismaMock.webAuthnChallenge.create).mockResolvedValue({} as any)
})

describe('POST /api/auth/passkey/link/options', () => {
  it('rejects unauthenticated requests with 401', async () => {
    vi.mocked(authenticate).mockRejectedValue(
      new AuthenticationError('Authorization header is required')
    )

    const res = await optionsPost(optionsReq())

    expect(res.status).toBe(401)
    expect(prismaMock.webAuthnChallenge.create).not.toHaveBeenCalled()
  })

  it('returns 404 when the authenticated pubkey has no User row', async () => {
    asUserA()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const res = await optionsPost(optionsReq())

    expect(res.status).toBe(404)
    // Must never lazily create an account on the LINK path.
    expect(prismaMock.user.create).not.toHaveBeenCalled()
    expect(prismaMock.webAuthnChallenge.create).not.toHaveBeenCalled()
  })

  it('excludes existing credentials and stores a LINK challenge bound to the user', async () => {
    asUserA()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: USER_A,
      passkeyCredentials: [
        { id: 'cred-a', transports: '["internal"]' },
        { id: 'cred-b', transports: null }
      ]
    } as any)
    vi.mocked(generateRegistrationOptions).mockResolvedValue({
      challenge: CHALLENGE,
      rp: { id: RP_ID, name: 'TestWallet' }
    } as any)

    const res = await optionsPost(optionsReq())
    const body: any = await assertResponse(res, 200)

    expect(body.options.challenge).toBe(CHALLENGE)
    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpID: RP_ID,
        rpName: 'TestWallet',
        userName: 'lawallet-' + PUBKEY_A.slice(0, 8),
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'required',
          userVerification: 'required'
        },
        excludeCredentials: [
          { id: 'cred-a', transports: ['internal'] },
          { id: 'cred-b', transports: undefined }
        ]
      })
    )
    expect(prismaMock.webAuthnChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        challenge: CHALLENGE,
        flow: 'LINK',
        userId: USER_A,
        rpId: RP_ID,
        origin: ORIGIN
      })
    })
  })
})

describe('POST /api/auth/passkey/link/verify', () => {
  it('rejects unauthenticated requests with 401', async () => {
    vi.mocked(authenticate).mockRejectedValue(
      new AuthenticationError('Authorization header is required')
    )

    const res = await verifyPost(
      verifyReq({ challenge: CHALLENGE, credential: validCredential })
    )

    expect(res.status).toBe(401)
    expect(prismaMock.passkeyCredential.create).not.toHaveBeenCalled()
  })

  it('returns 404 when the authenticated pubkey has no User row', async () => {
    asUserA()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue(null)

    const res = await verifyPost(
      verifyReq({ challenge: CHALLENGE, credential: validCredential })
    )

    expect(res.status).toBe(404)
    expect(prismaMock.webAuthnChallenge.delete).not.toHaveBeenCalled()
  })

  it('rejects a challenge bound to ANOTHER user with a generic 401', async () => {
    // The critical cross-user test: user A is authenticated, but the LINK
    // challenge was minted for user B. The consume step must reject even
    // though the challenge itself is valid and unexpired.
    asUserA()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: USER_A
    } as any)
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow({ userId: 'user-b' }) as any
    )

    const res = await verifyPost(
      verifyReq({ challenge: CHALLENGE, credential: validCredential })
    )
    const body: any = await res.json()

    expect(res.status).toBe(401)
    expect(body.error.message).toBe('Passkey verification failed')
    expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    expect(prismaMock.passkeyCredential.create).not.toHaveBeenCalled()
  })

  it('rejects an expired challenge with a generic 401', async () => {
    asUserA()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: USER_A
    } as any)
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow({ expiresAt: new Date(Date.now() - 1000) }) as any
    )

    const res = await verifyPost(
      verifyReq({ challenge: CHALLENGE, credential: validCredential })
    )

    expect(res.status).toBe(401)
    expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    expect(prismaMock.passkeyCredential.create).not.toHaveBeenCalled()
  })

  it('returns generic 401 when attestation verification fails', async () => {
    asUserA()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: USER_A
    } as any)
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow() as any
    )
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: false
    } as any)

    const res = await verifyPost(
      verifyReq({ challenge: CHALLENGE, credential: validCredential })
    )
    const body: any = await res.json()

    expect(res.status).toBe(401)
    expect(body.error.message).toBe('Passkey verification failed')
    expect(prismaMock.passkeyCredential.create).not.toHaveBeenCalled()
  })

  it('links the credential without EVER creating a managed key', async () => {
    asUserA()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: USER_A
    } as any)
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow() as any
    )
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo
    } as any)
    vi.mocked(prismaMock.passkeyCredential.create).mockResolvedValue(
      createdRow({ label: 'MacBook Touch ID' }) as any
    )

    const res = await verifyPost(
      verifyReq({
        challenge: CHALLENGE,
        credential: validCredential,
        label: 'MacBook Touch ID'
      })
    )
    const body: any = await assertResponse(res, 201)

    // Attestation verified against the values pinned in the challenge row.
    expect(verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: CHALLENGE,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true
      })
    )

    expect(prismaMock.passkeyCredential.create).toHaveBeenCalledWith({
      data: {
        id: 'cred-new',
        userId: USER_A,
        publicKey: Buffer.from([1, 2, 3]),
        counter: BigInt(5),
        transports: '["internal","hybrid"]',
        deviceType: 'multiDevice',
        backedUp: true,
        aaguid: 'aaguid-1',
        label: 'MacBook Touch ID',
        rpId: RP_ID
      }
    })

    // A linked user custodies their own Nostr key — the server must never
    // mint a ManagedNostrKey on this path.
    expect(prismaMock.managedNostrKey.create).not.toHaveBeenCalled()
    expect(prismaMock.managedNostrKey.upsert).not.toHaveBeenCalled()

    // Response is the safe summary only — no key material, no counter.
    expect(body.credential).toEqual({
      id: 'cred-new',
      label: 'MacBook Touch ID',
      deviceType: 'multiDevice',
      backedUp: true,
      aaguid: 'aaguid-1',
      rpId: RP_ID,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null
    })
    expect(body.credential.publicKey).toBeUndefined()
    expect(body.credential.counter).toBeUndefined()

    expect(logActivity.fireAndForget).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.passkey_linked',
        userId: USER_A,
        metadata: { credentialId: 'cred-new' }
      })
    )
  })

  it('maps a duplicate credential id (P2002) to 409', async () => {
    asUserA()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: USER_A
    } as any)
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow() as any
    )
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo
    } as any)
    vi.mocked(prismaMock.passkeyCredential.create).mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    )

    const res = await verifyPost(
      verifyReq({ challenge: CHALLENGE, credential: validCredential })
    )
    const body: any = await res.json()

    expect(res.status).toBe(409)
    expect(body.error.message).toContain('already registered')
  })

  it('works identically for a managed-custody user adding a second passkey', async () => {
    // A user whose Nostr key IS server-managed goes through the exact same
    // path — no branching on custody. The route only reads user.id, and it
    // still must not touch the ManagedNostrKey table.
    asUserA()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-managed'
    } as any)
    vi.mocked(prismaMock.webAuthnChallenge.delete).mockResolvedValue(
      challengeRow({ userId: 'user-managed' }) as any
    )
    vi.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo
    } as any)
    vi.mocked(prismaMock.passkeyCredential.create).mockResolvedValue(
      createdRow({ userId: 'user-managed' }) as any
    )

    const res = await verifyPost(
      verifyReq({ challenge: CHALLENGE, credential: validCredential })
    )
    const body: any = await assertResponse(res, 201)

    expect(body.credential.id).toBe('cred-new')
    expect(prismaMock.passkeyCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'user-managed' })
    })
    expect(prismaMock.managedNostrKey.create).not.toHaveBeenCalled()
    expect(prismaMock.managedNostrKey.update).not.toHaveBeenCalled()
    expect(prismaMock.managedNostrKey.upsert).not.toHaveBeenCalled()
  })
})
