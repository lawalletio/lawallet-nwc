import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { getPublicKey } from 'nostr-tools/pure'
import { server } from '@/tests/mocks/server'

// happy-dom ships no WebAuthn API — the ceremony layers are always mocked;
// the tests drive the HTTP round trips through MSW instead.
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startRegistration: vi.fn()
}))

vi.mock('@/lib/client/passkey-prf', () => ({
  getPrfAssertion: vi.fn(),
  derivePrfNsecHex: vi.fn()
}))

import {
  browserSupportsWebAuthn,
  startRegistration
} from '@simplewebauthn/browser'
import { derivePrfNsecHex, getPrfAssertion } from '@/lib/client/passkey-prf'
import {
  PasskeyError,
  authenticateWithPasskey,
  isPasskeySupported,
  linkPasskey,
  registerPasskeyAccount,
  translatePasskeyError
} from '@/lib/client/passkey-api'

const CHALLENGE = 'test-challenge-0123456789abcdef'
// A real secp256k1 secret so pubkey derivation works.
const SECRET_HEX =
  '0000000000000000000000000000000000000000000000000000000000000007'
const PUBKEY = getPublicKey(
  Uint8Array.from(Buffer.from(SECRET_HEX, 'hex'))
)

const PRF_OUTPUT = new Uint8Array(32).fill(9).buffer

const REGISTRATION_CREDENTIAL = {
  id: 'cred-id',
  rawId: 'cred-id',
  type: 'public-key',
  response: { attestationObject: 'att', clientDataJSON: 'cdj' },
  clientExtensionResults: { prf: { enabled: true } }
}

const CREDENTIAL_SUMMARY = {
  id: 'cred-id',
  label: null,
  deviceType: 'multiDevice',
  backedUp: true,
  aaguid: null,
  rpId: 'localhost',
  pubkey: PUBKEY,
  createdAt: new Date().toISOString(),
  lastUsedAt: null
}

beforeEach(() => {
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(true)
  vi.mocked(startRegistration).mockReset()
  vi.mocked(getPrfAssertion).mockReset()
  vi.mocked(derivePrfNsecHex).mockReset()
  vi.mocked(getPrfAssertion).mockResolvedValue({
    prfOutput: PRF_OUTPUT,
    credentialId: 'cred-id'
  })
  vi.mocked(derivePrfNsecHex).mockResolvedValue(SECRET_HEX)
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
  it('maps PrfUnsupportedError to the prf-unsupported kind', () => {
    const err = new Error('no prf')
    err.name = 'PrfUnsupportedError'
    const translated = translatePasskeyError(err)
    expect(translated.kind).toBe('prf-unsupported')
  })

  it('maps NotAllowedError to cancelled', () => {
    const err = new Error('closed')
    err.name = 'NotAllowedError'
    expect(translatePasskeyError(err).kind).toBe('cancelled')
  })

  it('passes PasskeyError instances through untouched', () => {
    const original = new PasskeyError('duplicate', 'dup')
    expect(translatePasskeyError(original)).toBe(original)
  })
})

describe('authenticateWithPasskey', () => {
  it('is fully client-side: PRF assertion → derived identity, no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const identity = await authenticateWithPasskey()

    expect(identity.secretHex).toBe(SECRET_HEX)
    expect(identity.pubkey).toBe(PUBKEY)
    expect(identity.nsec).toMatch(/^nsec1/)
    expect(identity.credentialId).toBe('cred-id')
    expect(vi.mocked(getPrfAssertion)).toHaveBeenCalledWith() // discoverable
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('translates PRF-unsupported into the prf-unsupported kind', async () => {
    const err = new Error('no prf result')
    err.name = 'PrfUnsupportedError'
    vi.mocked(getPrfAssertion).mockRejectedValue(err)

    await expect(authenticateWithPasskey()).rejects.toMatchObject({
      kind: 'prf-unsupported'
    })
  })
})

describe('registerPasskeyAccount', () => {
  function seedServer(
    onVerify?: (body: any) => Response | undefined
  ) {
    server.use(
      http.post('/api/auth/passkey/registration/options', () =>
        HttpResponse.json({ options: { challenge: CHALLENGE } })
      ),
      http.post(
        '/api/auth/passkey/registration/verify',
        async ({ request }) => {
          const body = await request.json()
          const custom = onVerify?.(body)
          if (custom) return custom
          return HttpResponse.json({
            pubkey: PUBKEY,
            credential: CREDENTIAL_SUMMARY
          })
        }
      )
    )
  }

  it('creates the credential, derives the identity, and proves the pubkey', async () => {
    let verifyBody: any
    seedServer(body => {
      verifyBody = body
      return undefined
    })
    vi.mocked(startRegistration).mockResolvedValue(
      REGISTRATION_CREDENTIAL as any
    )

    const result = await registerPasskeyAccount()

    expect(result.secretHex).toBe(SECRET_HEX)
    expect(result.pubkey).toBe(PUBKEY)
    expect(result.credential.id).toBe('cred-id')
    // The PRF eval pins the just-created credential.
    expect(vi.mocked(getPrfAssertion)).toHaveBeenCalledWith('cred-id')
    // The PRF extension is requested at creation.
    const regOptions = vi.mocked(startRegistration).mock.calls[0][0] as any
    expect(regOptions.optionsJSON.extensions.prf).toEqual({})
    // The verify body proves the derived pubkey with a kind-22242 event
    // answering the WebAuthn challenge.
    expect(verifyBody.pubkey).toBe(PUBKEY)
    expect(verifyBody.proof.kind).toBe(22242)
    expect(verifyBody.proof.pubkey).toBe(PUBKEY)
    expect(verifyBody.proof.tags).toContainEqual(['challenge', CHALLENGE])
    expect(typeof verifyBody.proof.sig).toBe('string')
  })

  it('rejects with prf-unsupported when the authenticator lacks PRF', async () => {
    seedServer()
    vi.mocked(startRegistration).mockResolvedValue({
      ...REGISTRATION_CREDENTIAL,
      clientExtensionResults: {}
    } as any)

    await expect(registerPasskeyAccount()).rejects.toMatchObject({
      kind: 'prf-unsupported'
    })
    expect(vi.mocked(getPrfAssertion)).not.toHaveBeenCalled()
  })

  it('maps a 409 verify response to the duplicate kind', async () => {
    seedServer(() =>
      HttpResponse.json(
        { error: { message: 'This passkey is already registered' } },
        { status: 409 }
      )
    )
    vi.mocked(startRegistration).mockResolvedValue(
      REGISTRATION_CREDENTIAL as any
    )

    await expect(registerPasskeyAccount()).rejects.toMatchObject({
      kind: 'duplicate'
    })
  })

  it('translates a ceremony rejection into a PasskeyError', async () => {
    seedServer()
    const err = new Error('closed')
    err.name = 'NotAllowedError'
    vi.mocked(startRegistration).mockRejectedValue(err)

    await expect(registerPasskeyAccount()).rejects.toMatchObject({
      kind: 'cancelled'
    })
  })
})

describe('linkPasskey', () => {
  it('sends the bearer token and returns the credential summary', async () => {
    let authHeader: string | null = null
    server.use(
      http.post('/api/auth/passkey/registration/options', ({ request }) => {
        authHeader = request.headers.get('authorization')
        return HttpResponse.json({ options: { challenge: CHALLENGE } })
      }),
      http.post('/api/auth/passkey/registration/verify', () =>
        HttpResponse.json({ pubkey: PUBKEY, credential: CREDENTIAL_SUMMARY })
      )
    )
    vi.mocked(startRegistration).mockResolvedValue(
      REGISTRATION_CREDENTIAL as any
    )

    const summary = await linkPasskey('jwt-token', 'My key')
    expect(summary.id).toBe('cred-id')
    expect(authHeader).toBe('Bearer jwt-token')
  })
})
