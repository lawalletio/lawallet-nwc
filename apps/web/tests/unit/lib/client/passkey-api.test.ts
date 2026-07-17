import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/tests/mocks/server'

// happy-dom ships no WebAuthn API — the browser ceremony layer is always
// mocked; the tests drive the HTTP round trips through MSW instead.
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startRegistration: vi.fn(),
  startAuthentication: vi.fn()
}))

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration
} from '@simplewebauthn/browser'
import {
  PasskeyError,
  authenticateWithPasskey,
  exportManagedKey,
  fetchManagedKey,
  isPasskeySupported,
  linkPasskey,
  refreshPasskeySession,
  registerPasskeyAccount,
  translatePasskeyError,
  type PasskeySession
} from '@/lib/client/passkey-api'

const CHALLENGE = 'test-challenge-0123456789abcdef'
const SIGNER_KEY = 'a'.repeat(64)
const PUBKEY = 'b'.repeat(64)

const SESSION: PasskeySession = {
  token: 'jwt-token',
  expiresIn: '24h',
  type: 'Bearer',
  pubkey: PUBKEY,
  custody: 'managed',
  signerKey: SIGNER_KEY
}

const REGISTRATION_CREDENTIAL = {
  id: 'cred-id',
  rawId: 'cred-id',
  type: 'public-key',
  response: { attestationObject: 'att', clientDataJSON: 'cdj' }
}

const AUTHENTICATION_CREDENTIAL = {
  id: 'cred-id',
  rawId: 'cred-id',
  type: 'public-key',
  response: { authenticatorData: 'ad', clientDataJSON: 'cdj', signature: 'sig' }
}

beforeEach(() => {
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(true)
  vi.mocked(startRegistration).mockReset()
  vi.mocked(startAuthentication).mockReset()
})

describe('isPasskeySupported', () => {
  it('returns true when the browser reports WebAuthn support', () => {
    expect(isPasskeySupported()).toBe(true)
  })

  it('returns false when browserSupportsWebAuthn is false', () => {
    vi.mocked(browserSupportsWebAuthn).mockReturnValue(false)
    expect(isPasskeySupported()).toBe(false)
  })
})

describe('translatePasskeyError', () => {
  it.each([
    ['NotAllowedError', 'cancelled'],
    ['AbortError', 'cancelled'],
    ['InvalidStateError', 'duplicate'],
    ['SecurityError', 'security'],
    ['NotSupportedError', 'unsupported']
  ] as const)('maps DOMException %s to kind %s', (name, kind) => {
    const translated = translatePasskeyError(new DOMException('boom', name))
    expect(translated).toBeInstanceOf(PasskeyError)
    expect(translated.kind).toBe(kind)
  })

  it('maps a plain Error with a WebAuthn name set to the same kind', () => {
    const err = new Error('nope')
    err.name = 'InvalidStateError'
    expect(translatePasskeyError(err).kind).toBe('duplicate')
  })

  it('maps a random Error to unknown and keeps its message', () => {
    const translated = translatePasskeyError(new Error('weird failure'))
    expect(translated.kind).toBe('unknown')
    expect(translated.message).toBe('weird failure')
  })

  it('maps a non-Error value to unknown with fallback copy', () => {
    const translated = translatePasskeyError('nope')
    expect(translated.kind).toBe('unknown')
    expect(translated.message).toBe('Passkey request failed')
  })

  it('passes PasskeyError instances through untouched', () => {
    const original = new PasskeyError('security', 'needs https')
    expect(translatePasskeyError(original)).toBe(original)
  })
})

describe('registerPasskeyAccount', () => {
  it('runs options → startRegistration → verify and returns the session', async () => {
    let optionsBody: unknown
    let verifyBody: unknown
    server.use(
      http.post(
        '/api/auth/passkey/registration/options',
        async ({ request }) => {
          optionsBody = await request.json()
          return HttpResponse.json({
            options: { challenge: CHALLENGE, rp: { name: 'test' } }
          })
        }
      ),
      http.post(
        '/api/auth/passkey/registration/verify',
        async ({ request }) => {
          verifyBody = await request.json()
          return HttpResponse.json(SESSION)
        }
      )
    )
    vi.mocked(startRegistration).mockResolvedValue(
      REGISTRATION_CREDENTIAL as never
    )

    const session = await registerPasskeyAccount('My phone')

    expect(optionsBody).toEqual({ label: 'My phone' })
    expect(startRegistration).toHaveBeenCalledWith({
      optionsJSON: { challenge: CHALLENGE, rp: { name: 'test' } }
    })
    expect(verifyBody).toEqual({
      challenge: CHALLENGE,
      credential: REGISTRATION_CREDENTIAL,
      label: 'My phone'
    })
    expect(session).toEqual(SESSION)
    expect(session.signerKey).toBe(SIGNER_KEY)
  })

  it('omits the label from both posts when not provided', async () => {
    let optionsBody: unknown
    let verifyBody: unknown
    server.use(
      http.post(
        '/api/auth/passkey/registration/options',
        async ({ request }) => {
          optionsBody = await request.json()
          return HttpResponse.json({ options: { challenge: CHALLENGE } })
        }
      ),
      http.post(
        '/api/auth/passkey/registration/verify',
        async ({ request }) => {
          verifyBody = await request.json()
          return HttpResponse.json(SESSION)
        }
      )
    )
    vi.mocked(startRegistration).mockResolvedValue(
      REGISTRATION_CREDENTIAL as never
    )

    await registerPasskeyAccount()

    expect(optionsBody).toEqual({})
    expect(verifyBody).toEqual({
      challenge: CHALLENGE,
      credential: REGISTRATION_CREDENTIAL
    })
  })

  it('translates a ceremony rejection into a PasskeyError', async () => {
    server.use(
      http.post('/api/auth/passkey/registration/options', () =>
        HttpResponse.json({ options: { challenge: CHALLENGE } })
      )
    )
    vi.mocked(startRegistration).mockRejectedValue(
      new DOMException('closed', 'NotAllowedError')
    )

    await expect(registerPasskeyAccount()).rejects.toMatchObject({
      name: 'PasskeyError',
      kind: 'cancelled'
    })
  })

  it('throws a duplicate PasskeyError when verify responds 409', async () => {
    server.use(
      http.post('/api/auth/passkey/registration/options', () =>
        HttpResponse.json({ options: { challenge: CHALLENGE } })
      ),
      http.post('/api/auth/passkey/registration/verify', () =>
        HttpResponse.json(
          { error: { message: 'Credential already registered' } },
          { status: 409 }
        )
      )
    )
    vi.mocked(startRegistration).mockResolvedValue(
      REGISTRATION_CREDENTIAL as never
    )

    await expect(registerPasskeyAccount()).rejects.toMatchObject({
      kind: 'duplicate',
      message: 'Credential already registered'
    })
  })
})

describe('authenticateWithPasskey', () => {
  it('runs options → startAuthentication → verify and returns the session', async () => {
    let verifyBody: unknown
    server.use(
      http.post('/api/auth/passkey/authentication/options', () =>
        HttpResponse.json({ options: { challenge: CHALLENGE } })
      ),
      http.post(
        '/api/auth/passkey/authentication/verify',
        async ({ request }) => {
          verifyBody = await request.json()
          return HttpResponse.json({ ...SESSION, signerKey: undefined })
        }
      )
    )
    vi.mocked(startAuthentication).mockResolvedValue(
      AUTHENTICATION_CREDENTIAL as never
    )

    const session = await authenticateWithPasskey()

    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: CHALLENGE }
    })
    expect(verifyBody).toEqual({
      challenge: CHALLENGE,
      credential: AUTHENTICATION_CREDENTIAL
    })
    expect(session.token).toBe('jwt-token')
    expect(session.signerKey).toBeUndefined()
  })

  it('translates a ceremony rejection into a PasskeyError', async () => {
    server.use(
      http.post('/api/auth/passkey/authentication/options', () =>
        HttpResponse.json({ options: { challenge: CHALLENGE } })
      )
    )
    vi.mocked(startAuthentication).mockRejectedValue(
      new DOMException('timeout', 'AbortError')
    )

    await expect(authenticateWithPasskey()).rejects.toMatchObject({
      name: 'PasskeyError',
      kind: 'cancelled'
    })
  })
})

describe('fetchManagedKey', () => {
  it('returns the managed key on 200', async () => {
    let authHeader: string | null = null
    server.use(
      http.get('/api/auth/passkey/signer-key', ({ request }) => {
        authHeader = request.headers.get('authorization')
        return HttpResponse.json({ signerKey: SIGNER_KEY, pubkey: PUBKEY })
      })
    )

    await expect(fetchManagedKey('tok')).resolves.toEqual({
      signerKey: SIGNER_KEY,
      pubkey: PUBKEY
    })
    expect(authHeader).toBe('Bearer tok')
  })

  it('returns null on 404 (linked-credential account)', async () => {
    server.use(
      http.get('/api/auth/passkey/signer-key', () =>
        HttpResponse.json(
          { error: { message: 'No managed key' } },
          { status: 404 }
        )
      )
    )

    await expect(fetchManagedKey('tok')).resolves.toBeNull()
  })

  it('throws a PasskeyError on 500', async () => {
    server.use(
      http.get('/api/auth/passkey/signer-key', () =>
        HttpResponse.json(
          { error: { message: 'Vault unavailable' } },
          { status: 500 }
        )
      )
    )

    await expect(fetchManagedKey('tok')).rejects.toMatchObject({
      name: 'PasskeyError',
      kind: 'unknown',
      message: 'Vault unavailable'
    })
  })
})

describe('exportManagedKey', () => {
  it('runs a fresh assertion then posts to nsec/export with the Bearer token', async () => {
    let optionsAuth: string | null = null
    let exportAuth: string | null = null
    let exportBody: unknown
    server.use(
      http.post('/api/auth/passkey/nsec/export/options', ({ request }) => {
        optionsAuth = request.headers.get('authorization')
        return HttpResponse.json({ options: { challenge: CHALLENGE } })
      }),
      http.post('/api/auth/passkey/nsec/export', async ({ request }) => {
        exportAuth = request.headers.get('authorization')
        exportBody = await request.json()
        return HttpResponse.json({ nsec: 'nsec1test', pubkey: PUBKEY })
      })
    )
    vi.mocked(startAuthentication).mockResolvedValue(
      AUTHENTICATION_CREDENTIAL as never
    )

    const result = await exportManagedKey('tok')

    expect(optionsAuth).toBe('Bearer tok')
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: CHALLENGE }
    })
    expect(exportAuth).toBe('Bearer tok')
    expect(exportBody).toEqual({
      challenge: CHALLENGE,
      credential: AUTHENTICATION_CREDENTIAL
    })
    expect(result).toEqual({ nsec: 'nsec1test', pubkey: PUBKEY })
  })

  it('translates a rejected assertion into a PasskeyError', async () => {
    server.use(
      http.post('/api/auth/passkey/nsec/export/options', () =>
        HttpResponse.json({ options: { challenge: CHALLENGE } })
      )
    )
    vi.mocked(startAuthentication).mockRejectedValue(
      new DOMException('blocked', 'SecurityError')
    )

    await expect(exportManagedKey('tok')).rejects.toMatchObject({
      kind: 'security'
    })
  })
})

describe('linkPasskey', () => {
  const SUMMARY = {
    id: 'cred_1',
    label: 'Work laptop',
    deviceType: 'multiDevice',
    backedUp: true,
    aaguid: null,
    rpId: 'localhost',
    createdAt: '2026-07-01T00:00:00.000Z',
    lastUsedAt: null
  }

  it('posts with the Bearer token and returns the credential summary', async () => {
    let optionsAuth: string | null = null
    let optionsBody: unknown
    let verifyAuth: string | null = null
    let verifyBody: unknown
    server.use(
      http.post('/api/auth/passkey/link/options', async ({ request }) => {
        optionsAuth = request.headers.get('authorization')
        optionsBody = await request.json()
        return HttpResponse.json({ options: { challenge: CHALLENGE } })
      }),
      http.post('/api/auth/passkey/link/verify', async ({ request }) => {
        verifyAuth = request.headers.get('authorization')
        verifyBody = await request.json()
        return HttpResponse.json({ credential: SUMMARY })
      })
    )
    vi.mocked(startRegistration).mockResolvedValue(
      REGISTRATION_CREDENTIAL as never
    )

    const summary = await linkPasskey('tok', 'Work laptop')

    expect(optionsAuth).toBe('Bearer tok')
    expect(optionsBody).toEqual({ label: 'Work laptop' })
    expect(verifyAuth).toBe('Bearer tok')
    expect(verifyBody).toEqual({
      challenge: CHALLENGE,
      credential: REGISTRATION_CREDENTIAL,
      label: 'Work laptop'
    })
    expect(summary).toEqual(SUMMARY)
  })

  it('translates a duplicate-credential ceremony error', async () => {
    server.use(
      http.post('/api/auth/passkey/link/options', () =>
        HttpResponse.json({ options: { challenge: CHALLENGE } })
      )
    )
    vi.mocked(startRegistration).mockRejectedValue(
      new DOMException('already registered', 'InvalidStateError')
    )

    await expect(linkPasskey('tok')).rejects.toMatchObject({
      kind: 'duplicate'
    })
  })
})

describe('refreshPasskeySession', () => {
  it('posts to session/refresh with the Bearer token and no body', async () => {
    let authHeader: string | null = null
    let rawBody: string | null = null
    server.use(
      http.post('/api/auth/passkey/session/refresh', async ({ request }) => {
        authHeader = request.headers.get('authorization')
        rawBody = await request.text()
        return HttpResponse.json({ ...SESSION, token: 'fresh-token' })
      })
    )

    const session = await refreshPasskeySession('old-token')

    expect(authHeader).toBe('Bearer old-token')
    expect(rawBody).toBe('')
    expect(session.token).toBe('fresh-token')
  })

  it('throws a PasskeyError when the refresh is rejected', async () => {
    server.use(
      http.post('/api/auth/passkey/session/refresh', () =>
        HttpResponse.json(
          { error: { message: 'Session too old' } },
          { status: 401 }
        )
      )
    )

    await expect(refreshPasskeySession('old-token')).rejects.toMatchObject({
      kind: 'unknown',
      message: 'Session too old'
    })
  })
})
