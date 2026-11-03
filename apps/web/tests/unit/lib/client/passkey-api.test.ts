import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  deriveNostrKey,
  derivedPrfInput,
  DEFAULT_DERIVED_PARAMETER_SET
} from '@nostr-wot/identity/vault'
import { getPublicKey } from 'nostr-tools/pure'
import { server } from '@/tests/mocks/server'

// happy-dom ships no WebAuthn API — the ceremony layers are always mocked;
// the tests drive the HTTP round trips through MSW instead.
vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startRegistration: vi.fn()
}))

vi.mock('@/lib/client/passkey-prf', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/client/passkey-prf')>()),
  getPrfAssertion: vi.fn(),
  passkeyAssertion: vi.fn(),
  derivePrfNsecHex: vi.fn()
}))

import {
  browserSupportsWebAuthn,
  startRegistration
} from '@simplewebauthn/browser'
import {
  PRF_SALT_HEX,
  derivePrfNsecHex,
  getPrfAssertion,
  passkeyAssertion
} from '@/lib/client/passkey-prf'
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
const PUBKEY = getPublicKey(Uint8Array.from(Buffer.from(SECRET_HEX, 'hex')))

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
  localStorage.clear()
  vi.mocked(browserSupportsWebAuthn).mockReturnValue(true)
  vi.mocked(startRegistration).mockReset()
  vi.mocked(getPrfAssertion).mockReset()
  vi.mocked(derivePrfNsecHex).mockReset()
  vi.mocked(passkeyAssertion).mockReset()
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
  it('does not mistake a domain rejection for insecure transport', () => {
    vi.stubGlobal('isSecureContext', true)
    try {
      const error = translatePasskeyError(
        new DOMException('Wrong RP', 'SecurityError')
      )
      expect(error.kind).toBe('security')
      expect(error.message).toContain('passkey domain')
      expect(error.message).not.toContain('need a secure connection')
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('explains insecure transport when the browser reports it', () => {
    vi.stubGlobal('isSecureContext', false)
    try {
      expect(
        translatePasskeyError(new DOMException('', 'SecurityError')).message
      ).toContain('need a secure connection')
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('maps PrfUnsupportedError to the prf-unsupported kind', () => {
    const err = new Error('no prf')
    err.name = 'PrfUnsupportedError'
    const translated = translatePasskeyError(err)
    expect(translated.kind).toBe('prf-unsupported')
  })

  it('maps ForeignPasskeyError to the foreign-passkey kind', () => {
    const err = new Error('foreign')
    err.name = 'ForeignPasskeyError'
    expect(translatePasskeyError(err).kind).toBe('foreign-passkey')
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
  function loginAssertion(userHandle: string | null, prf = true) {
    const result = {
      rawId: new Uint8Array([1, 2, 3]),
      credentialId: 'cred-id',
      userHandle:
        userHandle === null
          ? null
          : new Uint8Array(Buffer.from(userHandle, 'hex')),
      prfFirst: prf ? new Uint8Array(32).fill(9) : undefined,
      prfSecond: prf ? new Uint8Array(32).fill(8) : undefined
    }
    vi.mocked(passkeyAssertion).mockResolvedValue(result)
    return result
  }

  it('is fully client-side: PRF assertion → derived identity, no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const assertion = loginAssertion(
      '4e504b010102ffeeddccbbaa99887766554433221100'
    )

    const identity = await authenticateWithPasskey()

    expect(identity.secretHex).toBe(SECRET_HEX)
    expect(identity.pubkey).toBe(PUBKEY)
    expect(identity.nsec).toMatch(/^nsec1/)
    expect(identity.credentialId).toBe('cred-id')
    // One discoverable assertion asks for both modes; the derivation input
    // stays in `first`, exactly as before.
    const request = vi.mocked(passkeyAssertion).mock.calls[0][0]
    expect(request.credentialId).toBeUndefined()
    expect(Buffer.from(request.prf!.first).toString('hex')).toBe(PRF_SALT_HEX)
    expect(Buffer.from(request.prf!.second!).toString('hex')).toBe(
      '8b309d7051d41bda75ece773d6d35c49fb2ed7901f1e0261a476ac2646036e8e'
    )
    expect(request.largeBlob).toEqual({ read: true })
    expect(vi.mocked(derivePrfNsecHex)).toHaveBeenCalledTimes(1)
    // Both PRF outputs are wiped once the key is derived.
    expect(assertion.prfFirst!.every(b => b === 0)).toBe(true)
    expect(assertion.prfSecond!.every(b => b === 0)).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it.each(['valid', 'wrong credential', 'wrong handle', 'no PRF'] as const)(
    'recovers standard parameter 01 with a pinned assertion: %s',
    async scenario => {
      vi.mocked(derivePrfNsecHex).mockImplementation(
        async (output, parameters) => {
          const key = deriveNostrKey(
            output instanceof Uint8Array ? output : new Uint8Array(output),
            parameters ?? DEFAULT_DERIVED_PARAMETER_SET
          )
          try {
            return Buffer.from(key.secret).toString('hex')
          } finally {
            key.secret.fill(0)
          }
        }
      )
      const initial = loginAssertion(
        '4e504b010101ffeeddccbbaa99887766554433221100'
      )
      const retry = {
        ...initial,
        rawId: new Uint8Array([1, 2, 3]),
        prfFirst: new Uint8Array(32).fill(4),
        prfSecond: undefined
      }
      const expected = deriveNostrKey(
        retry.prfFirst,
        DEFAULT_DERIVED_PARAMETER_SET
      )
      if (scenario === 'wrong credential') retry.rawId = new Uint8Array([9])
      if (scenario === 'wrong handle') retry.userHandle = new Uint8Array(32)
      const output = retry.prfFirst
      if (scenario === 'no PRF') Object.assign(retry, { prfFirst: undefined })
      vi.mocked(passkeyAssertion)
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(retry)
      try {
        if (scenario === 'valid') {
          expect(await authenticateWithPasskey()).toMatchObject({
            pubkey: expected.pubkey,
            secretHex: Buffer.from(expected.secret).toString('hex')
          })
        } else {
          await expect(authenticateWithPasskey()).rejects.toMatchObject({
            kind: scenario === 'no PRF' ? 'prf-unsupported' : 'foreign-passkey'
          })
        }
        expect(passkeyAssertion).toHaveBeenNthCalledWith(2, {
          credentialId: initial.rawId,
          prf: { first: derivedPrfInput(DEFAULT_DERIVED_PARAMETER_SET) }
        })
        if (scenario !== 'valid')
          expect(derivePrfNsecHex).not.toHaveBeenCalled()
        expect(initial.prfFirst!.every(b => b === 0)).toBe(true)
        if (scenario !== 'no PRF') expect(output.every(b => b === 0)).toBe(true)
      } finally {
        expected.secret.fill(0)
      }
    }
  )

  it.each([1, 2])(
    'uses the remembered parameter %s in one assertion',
    async id => {
      localStorage.setItem('lawallet.passkey.parameters', String(id))
      loginAssertion(`4e504b01010${id}ffeeddccbbaa99887766554433221100`)
      await authenticateWithPasskey()
      expect(passkeyAssertion).toHaveBeenCalledTimes(1)
      expect(derivePrfNsecHex).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        expect.objectContaining({ id })
      )
    }
  )

  it('does not reinterpret a legacy credential using a remembered foreign format', async () => {
    localStorage.setItem('lawallet.passkey.parameters', '1')
    const initial = loginAssertion(null)
    vi.mocked(passkeyAssertion)
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({
        ...initial,
        prfFirst: new Uint8Array(32).fill(3)
      })
    await authenticateWithPasskey()
    expect(passkeyAssertion).toHaveBeenCalledTimes(2)
    expect(derivePrfNsecHex).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ id: 2 })
    )
    expect(localStorage.getItem('lawallet.passkey.parameters')).toBe('2')
  })

  it.each([
    ['legacy UUID', Buffer.from(crypto.randomUUID()).toString('hex')],
    ['missing', null]
  ])('derives from a %s handle as before', async (_label, handle) => {
    loginAssertion(handle)
    expect((await authenticateWithPasskey()).pubkey).toBe(PUBKEY)
  })

  it.each([
    ['another parameter set', '4e504b010103ffeeddccbbaa99887766554433221100'],
    ['legacy stored public key', '79'.repeat(32)],
    [
      'unsupported tagged handle',
      '4e504b02010000000000000000000000000000000000'
    ]
  ])('refuses %s without deriving', async (_label, handle) => {
    loginAssertion(handle)
    await expect(authenticateWithPasskey()).rejects.toMatchObject({
      kind: 'foreign-passkey'
    })
    expect(vi.mocked(derivePrfNsecHex)).not.toHaveBeenCalled()
  })

  it('translates PRF-unsupported into the prf-unsupported kind', async () => {
    loginAssertion(null, false)

    await expect(authenticateWithPasskey()).rejects.toMatchObject({
      kind: 'prf-unsupported'
    })
  })
})

describe('registerPasskeyAccount', () => {
  function seedServer(onVerify?: (body: any) => Response | undefined) {
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
    // The PRF is evaluated at creation with the fixed salt.
    const regOptions = vi.mocked(startRegistration).mock.calls[0][0] as any
    expect(
      new Uint8Array(regOptions.optionsJSON.extensions.prf.eval.first)
    ).toEqual(new Uint8Array(Buffer.from(PRF_SALT_HEX, 'hex')))
    // The verify body proves the derived pubkey with a kind-22242 event
    // answering the WebAuthn challenge.
    expect(verifyBody.pubkey).toBe(PUBKEY)
    expect(verifyBody.proof.kind).toBe(22242)
    expect(verifyBody.proof.pubkey).toBe(PUBKEY)
    expect(verifyBody.proof.tags).toContainEqual(['challenge', CHALLENGE])
    expect(typeof verifyBody.proof.sig).toBe('string')
  })

  it('rejects with prf-unsupported when the authenticator reports prf.enabled=false', async () => {
    seedServer()
    vi.mocked(startRegistration).mockResolvedValue({
      ...REGISTRATION_CREDENTIAL,
      clientExtensionResults: {
        prf: { enabled: false, results: { first: PRF_OUTPUT } }
      }
    } as any)

    await expect(registerPasskeyAccount()).rejects.toMatchObject({
      kind: 'prf-unsupported'
    })
    expect(vi.mocked(getPrfAssertion)).not.toHaveBeenCalled()
  })

  it('still tries the PRF assertion when the provider omits prf.enabled', async () => {
    seedServer()
    vi.mocked(startRegistration).mockResolvedValue({
      ...REGISTRATION_CREDENTIAL,
      clientExtensionResults: {}
    } as any)

    const result = await registerPasskeyAccount()
    expect(result.pubkey).toBe(PUBKEY)
    expect(vi.mocked(getPrfAssertion)).toHaveBeenCalledWith('cred-id')
  })

  it('uses a PRF result returned at creation — one prompt, never sent to the server', async () => {
    let verifyBody: any
    seedServer(body => {
      verifyBody = body
      return undefined
    })
    vi.mocked(startRegistration).mockResolvedValue({
      ...REGISTRATION_CREDENTIAL,
      clientExtensionResults: {
        prf: { enabled: true, results: { first: new Uint8Array(PRF_OUTPUT) } }
      }
    } as any)

    const result = await registerPasskeyAccount()
    expect(result.pubkey).toBe(PUBKEY)
    expect(vi.mocked(getPrfAssertion)).not.toHaveBeenCalled()
    expect(vi.mocked(derivePrfNsecHex)).toHaveBeenCalledWith(
      new Uint8Array(PRF_OUTPUT)
    )
    expect(verifyBody.credential.clientExtensionResults).toEqual({
      prf: { enabled: true }
    })
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
