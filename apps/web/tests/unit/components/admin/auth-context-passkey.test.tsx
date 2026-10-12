import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { NostrSigner } from '@nostrify/nostrify'

// happy-dom has no WebAuthn API and the provider pulls a wide import graph —
// stub every collaborator so the test exercises only the passkey session
// logic inside AuthProvider itself. Under the PRF model a passkey session
// is an nsec session whose secret came from the passkey: the derived key is
// persisted to localStorage and restored exactly like the nsec method.
const mocks = vi.hoisted(() => ({
  validateJwt: vi.fn(),
  exchangeNip98ForJwt: vi.fn(),
  createNsecSigner: vi.fn(),
  createBrowserSigner: vi.fn(),
  createBunkerSigner: vi.fn(),
  hasBrowserExtension: vi.fn(() => false),
  trackEvent: vi.fn(),
  clearSessionCaches: vi.fn(() => Promise.resolve()),
  waitForSessionCacheCleanup: vi.fn(() => Promise.resolve()),
  unlockDialogLoaded: vi.fn()
}))

vi.mock('@/lib/client/auth-api', () => ({
  validateJwt: mocks.validateJwt,
  exchangeNip98ForJwt: mocks.exchangeNip98ForJwt
}))
vi.mock('@/lib/client/nostr-signer', () => ({
  createNsecSigner: mocks.createNsecSigner,
  createBrowserSigner: mocks.createBrowserSigner,
  createBunkerSigner: mocks.createBunkerSigner,
  hasBrowserExtension: mocks.hasBrowserExtension
}))
vi.mock('@/lib/client/api-client', () => ({
  createApiClient: vi.fn(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn()
  }))
}))
vi.mock('@/lib/client/cache/session-cache', () => ({
  clearSessionCaches: mocks.clearSessionCaches,
  waitForSessionCacheCleanup: mocks.waitForSessionCacheCleanup
}))
vi.mock('@/components/admin/signer-unlock-dialog', () => {
  mocks.unlockDialogLoaded()
  return {
    SignerUnlockDialog: () => <div data-testid="unlock-dialog" />
  }
})
vi.mock('@/lib/analytics/gtag', () => ({
  trackEvent: mocks.trackEvent
}))

import {
  AuthProvider,
  useAuth,
  type AuthContextValue
} from '@/components/admin/auth-context'
import { Role } from '@/lib/auth/permissions'

const JWT_KEY = 'lawallet-jwt'
const METHOD_KEY = 'lawallet-login-method'
const SECRET_KEY = 'lawallet-signer-secret'

const PUBKEY = 'f'.repeat(64)
const DERIVED_SECRET = 'a'.repeat(64)

const STUB_SIGNER = {
  getPublicKey: vi.fn(async () => PUBKEY),
  signEvent: vi.fn()
} as unknown as NostrSigner

function validation(expiresInMs = 24 * 60 * 60 * 1000) {
  return {
    valid: true,
    pubkey: PUBKEY,
    role: Role.USER,
    permissions: [],
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + expiresInMs).toISOString()
  }
}

/** What validateJwt throws when GET /api/jwt answers with `status`. */
function rejected(status: number) {
  return Object.assign(new Error('Invalid or expired token'), { status })
}

function jwtWithExp(expSecondsFromNow: number): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' })
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + expSecondsFromNow
    })
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

// Holder object so the capture component writes a property rather than
// reassigning an outer binding (the latter trips the react-hooks compiler
// lint rule).
const held: { ctx: AuthContextValue | null } = { ctx: null }

function Capture() {
  const value = useAuth()
  held.ctx = value
  return (
    <>
      <span data-testid="status">{value.status}</span>
      <span data-testid="pubkey">{value.pubkey ?? ''}</span>
      <span data-testid="method">{value.loginMethod ?? ''}</span>
      <span data-testid="signer">{value.signer ? 'yes' : 'no'}</span>
    </>
  )
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Capture />
    </AuthProvider>
  )
}

async function flush(ms = 10) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  held.ctx = null
  mocks.validateJwt.mockResolvedValue(validation())
  mocks.exchangeNip98ForJwt.mockResolvedValue({ token: 'tok' })
  mocks.createNsecSigner.mockReturnValue(STUB_SIGNER)
  mocks.hasBrowserExtension.mockReturnValue(false)
})

afterEach(() => {
  cleanup()
})

describe('AuthProvider passkey sessions (PRF model)', () => {
  describe('login', () => {
    it('persists the derived secret like the nsec method and keeps the signer', async () => {
      renderProvider()
      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent(
          'unauthenticated'
        )
      )

      await act(async () => {
        await held.ctx!.login(STUB_SIGNER, 'passkey', {
          secret: DERIVED_SECRET
        })
      })

      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      expect(screen.getByTestId('pubkey')).toHaveTextContent(PUBKEY)
      expect(screen.getByTestId('method')).toHaveTextContent('passkey')
      expect(screen.getByTestId('signer')).toHaveTextContent('yes')
      expect(mocks.exchangeNip98ForJwt).toHaveBeenCalledWith(STUB_SIGNER)
      expect(localStorage.getItem(JWT_KEY)).toBe('tok')
      expect(localStorage.getItem(METHOD_KEY)).toBe('passkey')
      // The PRF-derived key persists at rest — that's what makes reloads
      // silent; there is no server custody to fall back to anymore.
      expect(localStorage.getItem(SECRET_KEY)).toBe(DERIVED_SECRET)
    })
  })

  describe('reload restore', () => {
    it('restores the session and silently rebuilds the signer from the stored secret', async () => {
      localStorage.setItem(JWT_KEY, 'stored-tok')
      localStorage.setItem(METHOD_KEY, 'passkey')
      localStorage.setItem(SECRET_KEY, DERIVED_SECRET)

      renderProvider()

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      )
      expect(mocks.validateJwt).toHaveBeenCalledWith('stored-tok')
      expect(screen.getByTestId('method')).toHaveTextContent('passkey')

      await waitFor(() =>
        expect(screen.getByTestId('signer')).toHaveTextContent('yes')
      )
      expect(mocks.createNsecSigner).toHaveBeenCalledWith(DERIVED_SECRET)
    })

    it('keeps the session alive signer-less when no secret is stored', async () => {
      localStorage.setItem(JWT_KEY, 'stored-tok')
      localStorage.setItem(METHOD_KEY, 'passkey')

      renderProvider()

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      )
      await flush()

      // Session survives; the signer simply stays empty (unlock on demand).
      expect(screen.getByTestId('signer')).toHaveTextContent('no')
      expect(mocks.createNsecSigner).not.toHaveBeenCalled()
      expect(localStorage.getItem(JWT_KEY)).toBe('stored-tok')
    })

    it('drops a malformed stored secret instead of failing every reload', async () => {
      localStorage.setItem(JWT_KEY, 'stored-tok')
      localStorage.setItem(METHOD_KEY, 'passkey')
      localStorage.setItem(SECRET_KEY, 'not-a-key')
      mocks.createNsecSigner.mockImplementation(() => {
        throw new Error('bad key')
      })

      renderProvider()

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      )
      await flush()

      expect(screen.getByTestId('signer')).toHaveTextContent('no')
      expect(localStorage.getItem(SECRET_KEY)).toBeNull()
    })
  })

  describe('requestSigner silent branch', () => {
    it('rebuilds the signer from the stored secret without opening the unlock dialog', async () => {
      localStorage.setItem(JWT_KEY, 'stored-tok')
      localStorage.setItem(METHOD_KEY, 'passkey')
      // No secret at mount → the session restores signer-less…
      renderProvider()

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      )
      await flush()
      expect(screen.getByTestId('signer')).toHaveTextContent('no')

      // …then the secret shows up (e.g. written by another tab's login) and
      // requestSigner reads localStorage at call time, silently rebuilding.
      localStorage.setItem(SECRET_KEY, DERIVED_SECRET)

      let signer: NostrSigner | null = null
      await act(async () => {
        signer = await held.ctx!.requestSigner()
      })

      expect(signer).toBe(STUB_SIGNER)
      expect(mocks.createNsecSigner).toHaveBeenCalledWith(DERIVED_SECRET)
      await waitFor(() =>
        expect(screen.getByTestId('signer')).toHaveTextContent('yes')
      )
    })
  })

  describe('logout', () => {
    it('clears the persisted secret with the session', async () => {
      localStorage.setItem(JWT_KEY, 'stored-tok')
      localStorage.setItem(METHOD_KEY, 'passkey')
      localStorage.setItem(SECRET_KEY, DERIVED_SECRET)

      renderProvider()
      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      )

      act(() => {
        held.ctx!.logout()
      })

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent(
          'unauthenticated'
        )
      )
      expect(localStorage.getItem(JWT_KEY)).toBeNull()
      expect(localStorage.getItem(METHOD_KEY)).toBeNull()
      expect(localStorage.getItem(SECRET_KEY)).toBeNull()
      expect(mocks.clearSessionCaches).toHaveBeenCalledOnce()
    })
  })
})

function fireVisibilityChange(state: DocumentVisibilityState = 'visible') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('AuthProvider visibility recheck', () => {
  it('keeps a live in-memory signer and does not rebuild it', async () => {
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    )

    await act(async () => {
      await held.ctx!.login(STUB_SIGNER, 'bunker', {
        secret: 'bunker://relay.example'
      })
    })

    expect(screen.getByTestId('signer')).toHaveTextContent('yes')
    const liveSigner = held.ctx!.signer
    mocks.createBunkerSigner.mockClear()
    mocks.createNsecSigner.mockClear()

    // A hanging restore would previously clobber the live bunker signer and
    // leave requestSigner() empty until the 15s timeout finished.
    mocks.createBunkerSigner.mockReturnValue(new Promise(() => {}))

    await act(async () => {
      fireVisibilityChange('visible')
    })

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    expect(screen.getByTestId('signer')).toHaveTextContent('yes')
    expect(held.ctx!.signer).toBe(liveSigner)
    expect(mocks.createBunkerSigner).not.toHaveBeenCalled()
    expect(mocks.createNsecSigner).not.toHaveBeenCalled()

    let requested: NostrSigner | null = null
    await act(async () => {
      requested = await held.ctx!.requestSigner()
    })
    expect(requested).toBe(liveSigner)
  })

  it('still restores a missing signer when the tab becomes visible', async () => {
    localStorage.setItem(JWT_KEY, 'stored-tok')
    localStorage.setItem(METHOD_KEY, 'bunker')

    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    )
    await flush()
    expect(screen.getByTestId('signer')).toHaveTextContent('no')

    localStorage.setItem(SECRET_KEY, 'bunker://relay.example')
    mocks.createBunkerSigner.mockResolvedValue(STUB_SIGNER)

    await act(async () => {
      fireVisibilityChange('visible')
    })

    await waitFor(() =>
      expect(screen.getByTestId('signer')).toHaveTextContent('yes')
    )
    expect(mocks.createBunkerSigner).toHaveBeenCalledWith(
      'bunker://relay.example',
      { timeout: 15_000 }
    )
  })

  it('silently remints when the server rejects the stored JWT and a signer is available', async () => {
    localStorage.setItem(JWT_KEY, 'stored-tok')
    localStorage.setItem(METHOD_KEY, 'bunker')
    localStorage.setItem(SECRET_KEY, 'bunker://relay.example')
    mocks.createBunkerSigner.mockResolvedValue(STUB_SIGNER)
    mocks.validateJwt.mockRejectedValueOnce(rejected(401))
    mocks.exchangeNip98ForJwt.mockResolvedValue({ token: 'fresh-tok' })

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    )
    expect(screen.getByTestId('signer')).toHaveTextContent('yes')
    expect(held.ctx!.signer).toBe(STUB_SIGNER)
    expect(mocks.exchangeNip98ForJwt).toHaveBeenCalledWith(STUB_SIGNER)
    expect(localStorage.getItem(JWT_KEY)).toBe('fresh-tok')
    expect(localStorage.getItem(SECRET_KEY)).toBe('bunker://relay.example')
  })

  it('signs out without wiping signer credentials when the JWT is rejected and remint fails', async () => {
    localStorage.setItem(JWT_KEY, 'stored-tok')
    localStorage.setItem(METHOD_KEY, 'bunker')
    localStorage.setItem(SECRET_KEY, 'bunker://relay.example')
    mocks.createBunkerSigner.mockResolvedValue(STUB_SIGNER)
    mocks.validateJwt.mockRejectedValue(rejected(401))
    mocks.exchangeNip98ForJwt.mockRejectedValue(new Error('nip98 failed'))

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    )
    expect(screen.getByTestId('signer')).toHaveTextContent('no')
    expect(localStorage.getItem(JWT_KEY)).toBeNull()
    expect(localStorage.getItem(METHOD_KEY)).toBe('bunker')
    expect(localStorage.getItem(SECRET_KEY)).toBe('bunker://relay.example')
  })

  it('keeps a JWT when validation is aborted before the server answers', async () => {
    const token = jwtWithExp(60 * 60)
    localStorage.setItem(JWT_KEY, token)
    mocks.validateJwt.mockRejectedValue(new TypeError('Failed to fetch'))

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    )
    expect(localStorage.getItem(JWT_KEY)).toBe(token)
  })

  it('does not drop a token written while an older check is in flight', async () => {
    let rejectValidate: (err: unknown) => void = () => {}
    const stale = jwtWithExp(60 * 60)
    mocks.validateJwt.mockImplementation((token: string) => {
      if (token !== stale) return Promise.resolve(validation())
      return new Promise((_resolve, reject) => {
        rejectValidate = reject
      })
    })
    localStorage.setItem(JWT_KEY, stale)
    renderProvider()
    await flush()

    const fresh = jwtWithExp(12 * 60 * 60)
    localStorage.setItem(JWT_KEY, fresh)
    await act(async () => {
      rejectValidate(new Error('invalid token'))
    })

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    )
    expect(localStorage.getItem(JWT_KEY)).toBe(fresh)
    expect(mocks.validateJwt).toHaveBeenCalledWith(fresh)
  })
})

describe('AuthProvider silent JWT remint', () => {
  it('remints from a stored passkey secret when the JWT is already expired', async () => {
    const expired = jwtWithExp(-60)
    localStorage.setItem(JWT_KEY, expired)
    localStorage.setItem(METHOD_KEY, 'passkey')
    localStorage.setItem(SECRET_KEY, DERIVED_SECRET)
    mocks.exchangeNip98ForJwt.mockResolvedValue({ token: 'fresh-tok' })

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    )
    expect(mocks.exchangeNip98ForJwt).toHaveBeenCalledWith(STUB_SIGNER)
    expect(mocks.createNsecSigner).toHaveBeenCalledWith(DERIVED_SECRET)
    expect(localStorage.getItem(JWT_KEY)).toBe('fresh-tok')
    expect(localStorage.getItem(SECRET_KEY)).toBe(DERIVED_SECRET)
    expect(screen.getByTestId('signer')).toHaveTextContent('yes')
    expect(mocks.validateJwt).not.toHaveBeenCalledWith(expired)
    expect(mocks.validateJwt).toHaveBeenCalledWith('fresh-tok')
  })

  it('remints on visibility when the JWT is inside the refresh buffer', async () => {
    localStorage.setItem(JWT_KEY, jwtWithExp(120))
    localStorage.setItem(METHOD_KEY, 'passkey')
    localStorage.setItem(SECRET_KEY, DERIVED_SECRET)

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    )
    expect(localStorage.getItem(JWT_KEY)).toBe('tok')
    expect(mocks.exchangeNip98ForJwt).toHaveBeenCalled()

    mocks.exchangeNip98ForJwt.mockClear()
    mocks.exchangeNip98ForJwt.mockResolvedValue({ token: 'newer-tok' })
    localStorage.setItem(JWT_KEY, jwtWithExp(90))

    await act(async () => {
      fireVisibilityChange('visible')
    })

    await waitFor(() => expect(localStorage.getItem(JWT_KEY)).toBe('newer-tok'))
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    expect(localStorage.getItem(SECRET_KEY)).toBe(DERIVED_SECRET)
  })

  it('remints on hydrate when the JWT is gone but signer credentials remain', async () => {
    localStorage.setItem(METHOD_KEY, 'passkey')
    localStorage.setItem(SECRET_KEY, DERIVED_SECRET)
    mocks.exchangeNip98ForJwt.mockResolvedValue({ token: 'recovered-tok' })

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    )
    expect(mocks.exchangeNip98ForJwt).toHaveBeenCalledWith(STUB_SIGNER)
    expect(localStorage.getItem(JWT_KEY)).toBe('recovered-tok')
  })

  it('does not remint an expired JWT while impersonating', async () => {
    localStorage.setItem(JWT_KEY, jwtWithExp(-60))
    localStorage.setItem('lawallet-impersonator-return', JSON.stringify({}))
    mocks.exchangeNip98ForJwt.mockClear()

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    )
    expect(mocks.exchangeNip98ForJwt).not.toHaveBeenCalled()
    expect(localStorage.getItem('lawallet-impersonator-return')).not.toBeNull()
  })

  it('keeps signer credentials when another tab drops only the JWT', async () => {
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    )

    await act(async () => {
      await held.ctx!.login(STUB_SIGNER, 'passkey', {
        secret: DERIVED_SECRET
      })
    })
    expect(localStorage.getItem(SECRET_KEY)).toBe(DERIVED_SECRET)

    localStorage.removeItem(JWT_KEY)
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: JWT_KEY,
          oldValue: 'tok',
          newValue: null,
          storageArea: window.localStorage
        })
      )
    })

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    )
    expect(localStorage.getItem(SECRET_KEY)).toBe(DERIVED_SECRET)
    expect(localStorage.getItem(METHOD_KEY)).toBe('passkey')
  })
})

/** A session JWT carrying the claims POST /api/jwt bakes in. */
function sessionJwt(
  expSecondsFromNow = 24 * 60 * 60,
  claims: Record<string, unknown> = {}
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(
    JSON.stringify({
      pubkey: PUBKEY,
      role: Role.ADMIN,
      permissions: ['settings:read'],
      iat: now,
      exp: now + expSecondsFromNow,
      ...claims
    })
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

describe('AuthProvider optimistic session', () => {
  it('is authenticated from the stored claims before validation answers', async () => {
    localStorage.setItem(JWT_KEY, sessionJwt())
    mocks.validateJwt.mockReturnValue(new Promise(() => {}))

    renderProvider()

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    )
    expect(screen.getByTestId('pubkey')).toHaveTextContent(PUBKEY)
    expect(held.ctx!.role).toBe(Role.ADMIN)
    expect(held.ctx!.permissions).toEqual(['settings:read'])
  })

  it.each([
    ['offline', new TypeError('Failed to fetch')],
    ['timeout', new Error('JWT validation timed out')],
    ['server error', rejected(500)],
    ['rate limit', rejected(429)]
  ])('stays signed in on a %s', async (_label, error) => {
    const token = sessionJwt()
    localStorage.setItem(JWT_KEY, token)
    mocks.validateJwt.mockRejectedValue(error)

    renderProvider()
    await waitFor(() => expect(mocks.validateJwt).toHaveBeenCalled())
    await flush()

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    expect(localStorage.getItem(JWT_KEY)).toBe(token)
    expect(mocks.exchangeNip98ForJwt).not.toHaveBeenCalled()
  })

  it.each([401, 403])(
    'drops the session when the server answers %i',
    async status => {
      localStorage.setItem(JWT_KEY, sessionJwt())
      mocks.validateJwt.mockRejectedValue(rejected(status))

      renderProvider()

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent(
          'unauthenticated'
        )
      )
      expect(localStorage.getItem(JWT_KEY)).toBeNull()
    }
  )

  it('does not re-render consumers when validation confirms the claims', async () => {
    const token = sessionJwt()
    localStorage.setItem(JWT_KEY, token)
    let confirm: (v: unknown) => void = () => {}
    mocks.validateJwt.mockReturnValue(
      new Promise(resolve => {
        confirm = resolve
      })
    )

    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    )
    const before = held.ctx

    await act(async () => {
      confirm({
        ...validation(),
        pubkey: PUBKEY,
        role: Role.ADMIN,
        permissions: ['settings:read']
      })
    })
    await flush()

    expect(held.ctx).toBe(before)
  })

  it('falls back to server validation for a token without readable claims', async () => {
    localStorage.setItem(JWT_KEY, 'opaque-tok')
    mocks.validateJwt.mockReturnValue(new Promise(() => {}))

    renderProvider()
    await flush()

    expect(screen.getByTestId('status')).toHaveTextContent('loading')
  })

  it('ignores claims with an unknown role', async () => {
    localStorage.setItem(JWT_KEY, sessionJwt(3600, { role: 'GOD' }))
    mocks.validateJwt.mockReturnValue(new Promise(() => {}))

    renderProvider()
    await flush()

    expect(screen.getByTestId('status')).toHaveTextContent('loading')
  })

  it('skips the network on resume while the token is fresh', async () => {
    localStorage.setItem(JWT_KEY, sessionJwt())

    renderProvider()
    await waitFor(() => expect(mocks.validateJwt).toHaveBeenCalledTimes(1))
    await flush()

    await act(async () => {
      fireVisibilityChange('visible')
      window.dispatchEvent(new Event('focus'))
    })
    await flush()

    expect(mocks.validateJwt).toHaveBeenCalledTimes(1)
    expect(mocks.exchangeNip98ForJwt).not.toHaveBeenCalled()
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
  })

  it('re-checks on resume a token the server never confirmed', async () => {
    localStorage.setItem(JWT_KEY, sessionJwt())
    mocks.validateJwt.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    renderProvider()
    await waitFor(() => expect(mocks.validateJwt).toHaveBeenCalledTimes(1))
    await flush()
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')

    // Back online, and the token turns out to be bad (e.g. secret rotated).
    mocks.validateJwt.mockRejectedValueOnce(rejected(401))
    await act(async () => {
      fireVisibilityChange('visible')
    })

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    )
    expect(mocks.validateJwt).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a non-hex pubkey', { pubkey: 'npub1notahexkey' }],
    ['an unknown permission', { permissions: ['everything'] }]
  ])('ignores claims with %s', async (_label, claims) => {
    localStorage.setItem(JWT_KEY, sessionJwt(3600, claims))
    mocks.validateJwt.mockReturnValue(new Promise(() => {}))

    renderProvider()
    await flush()

    expect(screen.getByTestId('status')).toHaveTextContent('loading')
  })

  it('reads identity from a freshly minted token instead of a second request', async () => {
    const minted = sessionJwt()
    mocks.exchangeNip98ForJwt.mockResolvedValue({ token: minted })
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated')
    )

    await act(async () => {
      await held.ctx!.login(STUB_SIGNER, 'extension')
    })

    expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    expect(held.ctx!.role).toBe(Role.ADMIN)
    expect(mocks.validateJwt).not.toHaveBeenCalled()
  })
})

describe('AuthProvider signer unlock dialog', () => {
  it('loads the dialog only when a signer is requested', async () => {
    localStorage.setItem(JWT_KEY, sessionJwt())
    localStorage.setItem(METHOD_KEY, 'nsec')

    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
    )
    await flush()
    expect(mocks.unlockDialogLoaded).not.toHaveBeenCalled()
    expect(screen.queryByTestId('unlock-dialog')).toBeNull()

    act(() => {
      void held.ctx!.requestSigner().catch(() => {})
    })

    expect(await screen.findByTestId('unlock-dialog')).toBeInTheDocument()
    expect(mocks.unlockDialogLoaded).toHaveBeenCalled()
  })
})
