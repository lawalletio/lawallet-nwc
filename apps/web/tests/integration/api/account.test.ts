import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { createNextRequest } from '@/tests/helpers/api-helpers'
import { prismaMock, resetPrismaMock } from '@/tests/helpers/prisma-mock'
import { createParamsPromise } from '@/tests/helpers/route-helpers'

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

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  resolveAccountByPubkey: vi.fn(),
}))

vi.mock('@/lib/activity-log', () => ({
  ActivityEvent: new Proxy({}, { get: (_t, key) => `user.${String(key).toLowerCase()}` }),
  logActivity: Object.assign(vi.fn(), { fireAndForget: vi.fn() }),
}))

vi.mock('@/lib/account/merge', () => ({
  linkPubkeyToAccount: vi.fn(),
  previewMerge: vi.fn(),
  mergeAccounts: vi.fn(),
  setPrimaryIdentity: vi.fn(),
  unlinkIdentity: vi.fn(),
}))

vi.mock('@/lib/auth/passkey', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/auth/passkey')>()
  return {
    ...original,
    verifyStoredCredentialAssertion: vi.fn(),
  }
})

import { GET } from '@/app/api/account/route'
import { POST as linkBegin } from '@/app/api/account/identities/link/begin/route'
import { POST as linkVerify } from '@/app/api/account/identities/link/verify/route'
import { POST as mergePreview } from '@/app/api/account/merge/preview/route'
import { POST as mergeCommit } from '@/app/api/account/merge/route'
import { PATCH, DELETE } from '@/app/api/account/identities/[pubkey]/route'
import { authenticate } from '@/lib/auth/unified-auth'
import { resolveAccountByPubkey } from '@/lib/auth/account'
import {
  linkPubkeyToAccount,
  previewMerge,
  mergeAccounts,
  setPrimaryIdentity,
  unlinkIdentity,
} from '@/lib/account/merge'
import { verifyStoredCredentialAssertion } from '@/lib/auth/passkey'
import { mintMergeTicket, LINK_PROOF_EVENT_KIND } from '@/lib/account/proof'
import { Role } from '@/lib/auth/permissions'

const PK_A = 'a'.repeat(64)
const ACCOUNT = {
  id: 'user-a',
  primaryPubkey: PK_A,
  authPubkey: PK_A,
  role: 'USER',
}

function authedAs(account: typeof ACCOUNT | null = ACCOUNT) {
  vi.mocked(authenticate).mockResolvedValue({
    pubkey: PK_A,
    role: Role.USER,
    method: 'jwt',
  } as any)
  vi.mocked(resolveAccountByPubkey).mockResolvedValue(account as any)
}

beforeEach(() => {
  resetPrismaMock()
  vi.clearAllMocks()
})

describe('GET /api/account', () => {
  it('returns the summary shape', async () => {
    authedAs()
    vi.mocked(prismaMock.user.findUnique).mockResolvedValue({
      id: 'user-a',
      pubkey: PK_A,
      nostrIdentities: [
        { pubkey: PK_A, isPrimary: true, label: null, createdAt: new Date() },
      ],
      passkeyCredentials: [],
      managedNostrKey: { exportedAt: null },
    } as any)

    const response = await GET(createNextRequest('/api/account'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.primaryPubkey).toBe(PK_A)
    expect(body.identities).toHaveLength(1)
    expect(body.identities[0].isPrimary).toBe(true)
    expect(body.hasManagedKey).toBe(true)
    expect(body.managedKeyExported).toBe(false)
  })

  it('401s without auth', async () => {
    vi.mocked(authenticate).mockRejectedValue(
      Object.assign(new Error('nope'), { statusCode: 401 })
    )
    const response = await GET(createNextRequest('/api/account'))
    expect(response.status).toBeGreaterThanOrEqual(401)
  })
})

describe('POST /api/account/identities/link — nostr proof', () => {
  async function beginNostr(): Promise<{ challenge: string; nonce: string }> {
    const response = await linkBegin(
      createNextRequest('/api/account/identities/link/begin', {
        method: 'POST',
        body: { method: 'nostr' },
      })
    )
    expect(response.status).toBe(200)
    return response.json()
  }

  function proofFor(nonce: string) {
    const sk = generateSecretKey()
    const event = JSON.parse(
      JSON.stringify(
        finalizeEvent(
          {
            kind: LINK_PROOF_EVENT_KIND,
            created_at: Math.floor(Date.now() / 1000),
            tags: [['challenge', nonce]],
            content: '',
          },
          sk
        )
      )
    )
    return { event, pubkey: getPublicKey(sk) }
  }

  it('links a bare (unowned) pubkey as a secondary identity', async () => {
    authedAs()
    const { challenge, nonce } = await beginNostr()
    const { event, pubkey } = proofFor(nonce)

    // The proven pubkey resolves to no account → direct attach.
    vi.mocked(resolveAccountByPubkey).mockImplementation(async pk =>
      pk === PK_A ? (ACCOUNT as any) : null
    )
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      pubkey,
      isPrimary: false,
      label: null,
      createdAt: new Date(),
    } as any)

    const response = await linkVerify(
      createNextRequest('/api/account/identities/link/verify', {
        method: 'POST',
        body: { method: 'nostr', challenge, event },
      })
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.linked).toBe(true)
    expect(vi.mocked(linkPubkeyToAccount)).toHaveBeenCalledWith(
      'user-a',
      pubkey,
      undefined
    )
  })

  it('returns a merge ticket when the pubkey belongs to another account', async () => {
    authedAs()
    const { challenge, nonce } = await beginNostr()
    const { event, pubkey } = proofFor(nonce)

    vi.mocked(resolveAccountByPubkey).mockImplementation(async pk =>
      pk === PK_A
        ? (ACCOUNT as any)
        : ({ id: 'user-b', primaryPubkey: pubkey, authPubkey: pk, role: 'USER' } as any)
    )
    vi.mocked(previewMerge).mockResolvedValue({
      survivor: {},
      absorbed: { userId: 'user-b' },
      collisions: [],
      blocked: false,
    } as any)

    const response = await linkVerify(
      createNextRequest('/api/account/identities/link/verify', {
        method: 'POST',
        body: { method: 'nostr', challenge, event },
      })
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.linked).toBe(false)
    expect(body.mergeTicket).toBeTruthy()
    expect(body.otherAccount.userId).toBe('user-b')
    expect(vi.mocked(linkPubkeyToAccount)).not.toHaveBeenCalled()
  })

  it('409s when the key is already on the caller account', async () => {
    authedAs()
    const { challenge, nonce } = await beginNostr()
    const { event, pubkey } = proofFor(nonce)

    vi.mocked(resolveAccountByPubkey).mockImplementation(async pk =>
      pk === PK_A || pk === pubkey ? (ACCOUNT as any) : null
    )

    const response = await linkVerify(
      createNextRequest('/api/account/identities/link/verify', {
        method: 'POST',
        body: { method: 'nostr', challenge, event },
      })
    )
    expect(response.status).toBe(409)
  })

  it('401s on a proof event signed for a different nonce', async () => {
    authedAs()
    const { challenge } = await beginNostr()
    const { event } = proofFor('some-other-nonce')

    const response = await linkVerify(
      createNextRequest('/api/account/identities/link/verify', {
        method: 'POST',
        body: { method: 'nostr', challenge, event },
      })
    )
    expect(response.status).toBe(401)
  })
})

describe('POST /api/account/identities/link — passkey proof', () => {
  it('always yields a merge ticket (credentials always have an account)', async () => {
    authedAs()
    vi.mocked(verifyStoredCredentialAssertion).mockResolvedValue({
      id: 'cred-1',
      userId: 'user-b',
      user: { id: 'user-b', pubkey: 'c'.repeat(64) },
    } as any)
    vi.mocked(previewMerge).mockResolvedValue({
      survivor: {},
      absorbed: { userId: 'user-b' },
      collisions: [],
      blocked: false,
    } as any)

    const response = await linkVerify(
      createNextRequest('/api/account/identities/link/verify', {
        method: 'POST',
        body: {
          method: 'passkey',
          challenge: 'x'.repeat(32),
          credential: {
            id: 'cred-1',
            rawId: 'cred-1',
            type: 'public-key',
            response: {
              clientDataJSON: 'x',
              authenticatorData: 'x',
              signature: 'x',
            },
            clientExtensionResults: {},
          },
        },
      })
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.linked).toBe(false)
    expect(body.mergeTicket).toBeTruthy()
    expect(vi.mocked(verifyStoredCredentialAssertion)).toHaveBeenCalledWith(
      expect.objectContaining({ flow: 'LOGIN' })
    )
  })

  it('409s when the credential belongs to the caller already', async () => {
    authedAs()
    vi.mocked(verifyStoredCredentialAssertion).mockResolvedValue({
      id: 'cred-1',
      userId: 'user-a',
      user: { id: 'user-a', pubkey: PK_A },
    } as any)

    const response = await linkVerify(
      createNextRequest('/api/account/identities/link/verify', {
        method: 'POST',
        body: {
          method: 'passkey',
          challenge: 'x'.repeat(32),
          credential: {
            id: 'cred-1',
            rawId: 'cred-1',
            type: 'public-key',
            response: {
              clientDataJSON: 'x',
              authenticatorData: 'x',
              signature: 'x',
            },
            clientExtensionResults: {},
          },
        },
      })
    )
    expect(response.status).toBe(409)
  })
})

describe('merge preview + commit', () => {
  it('preview verifies ticket binding and returns the dry run', async () => {
    authedAs()
    const ticket = mintMergeTicket({
      survivorId: 'user-a',
      absorbedId: 'user-b',
      provenPubkey: 'c'.repeat(64),
    })
    vi.mocked(previewMerge).mockResolvedValue({
      survivor: {},
      absorbed: {},
      collisions: [],
      blocked: false,
    } as any)

    const response = await mergePreview(
      createNextRequest('/api/account/merge/preview', {
        method: 'POST',
        body: { mergeTicket: ticket },
      })
    )
    expect(response.status).toBe(200)
    expect(vi.mocked(previewMerge)).toHaveBeenCalledWith('user-a', 'user-b')
  })

  it('rejects a ticket minted for a different survivor', async () => {
    authedAs()
    const foreign = mintMergeTicket({
      survivorId: 'user-x',
      absorbedId: 'user-b',
      provenPubkey: 'c'.repeat(64),
    })
    const response = await mergePreview(
      createNextRequest('/api/account/merge/preview', {
        method: 'POST',
        body: { mergeTicket: foreign },
      })
    )
    expect(response.status).toBe(401)
    expect(vi.mocked(previewMerge)).not.toHaveBeenCalled()
  })

  it('commit calls the engine with the selected main pubkey', async () => {
    authedAs()
    const ticket = mintMergeTicket({
      survivorId: 'user-a',
      absorbedId: 'user-b',
      provenPubkey: 'c'.repeat(64),
    })
    vi.mocked(mergeAccounts).mockResolvedValue({
      survivorId: 'user-a',
      mainPubkey: 'c'.repeat(64),
      movedIdentities: 1,
      movedPasskeys: 0,
      movedAddresses: 2,
      movedWallets: 1,
    } as any)

    const response = await mergeCommit(
      createNextRequest('/api/account/merge', {
        method: 'POST',
        body: { mergeTicket: ticket, mainPubkey: 'c'.repeat(64) },
      })
    )
    expect(response.status).toBe(200)
    expect(vi.mocked(mergeAccounts)).toHaveBeenCalledWith({
      survivorId: 'user-a',
      absorbedId: 'user-b',
      mainPubkey: 'c'.repeat(64),
    })
  })
})

describe('identities PATCH/DELETE', () => {
  const OTHER_PK = 'd'.repeat(64)

  it('promotes a secondary to primary', async () => {
    authedAs()
    vi.mocked(prismaMock.nostrIdentity.findUnique)
      .mockResolvedValueOnce({ pubkey: OTHER_PK, userId: 'user-a', isPrimary: false } as any)
      .mockResolvedValueOnce({
        pubkey: OTHER_PK,
        userId: 'user-a',
        isPrimary: true,
        label: null,
        createdAt: new Date(),
      } as any)

    const response = await PATCH(
      createNextRequest(`/api/account/identities/${OTHER_PK}`, {
        method: 'PATCH',
        body: { isPrimary: true },
      }),
      createParamsPromise({ pubkey: OTHER_PK })
    )
    expect(response.status).toBe(200)
    expect(vi.mocked(setPrimaryIdentity)).toHaveBeenCalledWith('user-a', OTHER_PK)
  })

  it('404s (not 403) for a foreign identity', async () => {
    authedAs()
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      pubkey: OTHER_PK,
      userId: 'someone-else',
      isPrimary: false,
    } as any)

    const response = await DELETE(
      createNextRequest(`/api/account/identities/${OTHER_PK}`, { method: 'DELETE' }),
      createParamsPromise({ pubkey: OTHER_PK })
    )
    expect(response.status).toBe(404)
    expect(vi.mocked(unlinkIdentity)).not.toHaveBeenCalled()
  })

  it('unlinks an owned secondary', async () => {
    authedAs()
    vi.mocked(prismaMock.nostrIdentity.findUnique).mockResolvedValue({
      pubkey: OTHER_PK,
      userId: 'user-a',
      isPrimary: false,
    } as any)

    const response = await DELETE(
      createNextRequest(`/api/account/identities/${OTHER_PK}`, { method: 'DELETE' }),
      createParamsPromise({ pubkey: OTHER_PK })
    )
    expect(response.status).toBe(200)
    expect(vi.mocked(unlinkIdentity)).toHaveBeenCalledWith('user-a', OTHER_PK)
  })
})
