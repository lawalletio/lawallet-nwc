import { describe, expect, it } from 'vitest'
import { getOpenApiDocument, OPENAPI_VERSION } from '../src'

describe('getOpenApiDocument', () => {
  const doc = getOpenApiDocument()

  it('produces a valid OpenAPI 3.1 document envelope', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.title).toBe('LaWallet NWC API')
    expect(doc.info.version).toBe(OPENAPI_VERSION)
  })

  it('registers expected security schemes', () => {
    const schemes = doc.components?.securitySchemes ?? {}
    expect(Object.keys(schemes)).toEqual(
      expect.arrayContaining(['BearerJWT', 'NIP98', 'EventsToken']),
    )
  })

  it('exposes a non-empty path map', () => {
    expect(doc.paths).toBeDefined()
    expect(Object.keys(doc.paths ?? {}).length).toBeGreaterThan(20)
  })

  it('covers every documented resource group', () => {
    const paths = Object.keys(doc.paths ?? {})
    const expectations = [
      '/api/jwt',
      '/api/auth/passkey/registration/options',
      '/api/auth/passkey/registration/verify',
      '/api/auth/passkey/credentials',
      '/api/auth/passkey/credentials/{id}',
      '/api/account',
      '/api/account/identities/link/begin',
      '/api/account/identities/link/verify',
      '/api/account/identities/{pubkey}',
      '/api/account/merge/preview',
      '/api/account/merge',
      '/api/cards',
      '/api/cards/{id}',
      '/api/card-designs',
      '/api/lightning-addresses',
      '/api/lud16/{username}',
      '/api/lud16/{username}/cb',
      '/api/lud16/{username}/verify/{paymentHash}',
      '/api/wallet/addresses',
      '/api/users',
      '/api/users/me',
      '/api/users/{userId}',
      '/api/invoices',
      '/api/settings',
      '/api/admin/assign',
      '/api/setup/status',
      '/api/version',
      '/api/remote-connections/{externalDeviceKey}',
      '/api/remote-wallets',
      '/api/remote-wallets/{id}',
      '/api/activity',
      '/api/events',
    ]
    for (const expected of expectations) {
      expect(paths).toContain(expected)
    }
  })

  it('does not document endpoints removed by the client-side PRF model', () => {
    const paths = Object.keys(doc.paths ?? {})
    const removed = [
      '/api/auth/passkey/authentication/options',
      '/api/auth/passkey/authentication/verify',
      '/api/auth/passkey/link/options',
      '/api/auth/passkey/link/verify',
      '/api/auth/passkey/signer-key',
      '/api/auth/passkey/nsec/export/options',
      '/api/auth/passkey/nsec/export',
      '/api/auth/passkey/session/refresh',
    ]
    for (const gone of removed) {
      expect(paths).not.toContain(gone)
    }
  })

  it('registers the standard error envelope component', () => {
    expect(doc.components?.schemas?.ErrorEnvelope).toBeDefined()
  })

  it('marks public routes with empty security', () => {
    const lud16 = doc.paths?.['/api/lud16/{username}']?.get
    expect(lud16?.security).toEqual([])
    const setupStatus = doc.paths?.['/api/setup/status']?.get
    expect(setupStatus?.security).toEqual([])
  })

  it('marks the SSE stream as text/event-stream with EventsToken security', () => {
    const events = doc.paths?.['/api/events']?.get
    expect(events?.security).toEqual([{ EventsToken: [] }])
    expect(events?.responses?.[200]?.content?.['text/event-stream']).toBeDefined()
  })
})
