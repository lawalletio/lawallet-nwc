import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
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
  clearApiCache: vi.fn(),
  clearAllBalances: vi.fn(),
  clearAllActivity: vi.fn(() => Promise.resolve())
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
vi.mock('@/lib/client/hooks/use-api', () => ({
  clearApiCache: mocks.clearApiCache
}))
vi.mock('@/lib/client/cache/balance-cache', () => ({
  clearAllBalances: mocks.clearAllBalances
}))
vi.mock('@/lib/client/cache/activity-cache', () => ({
  clearAll: mocks.clearAllActivity
}))
vi.mock('@/components/admin/signer-unlock-dialog', () => ({
  SignerUnlockDialog: () => null
}))
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

function validation(expiresInMs = 60_000) {
  return {
    valid: true,
    pubkey: PUBKEY,
    role: Role.USER,
    permissions: [],
    issuedAt: new Date().toISOString(),
    // Under the 5-minute refresh buffer on purpose so no refresh timer is
    // ever scheduled during these tests.
    expiresAt: new Date(Date.now() + expiresInMs).toISOString()
  }
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
    })
  })
})
