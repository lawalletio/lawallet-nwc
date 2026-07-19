import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { NostrSigner } from '@nostrify/nostrify'

// happy-dom has no WebAuthn API and the provider pulls a wide import graph —
// stub every collaborator so the test exercises only the passkey session
// logic inside AuthProvider itself.
const mocks = vi.hoisted(() => ({
  validateJwt: vi.fn(),
  exchangeNip98ForJwt: vi.fn(),
  fetchManagedKey: vi.fn(),
  refreshPasskeySession: vi.fn(),
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
vi.mock('@/lib/client/passkey-api', () => ({
  fetchManagedKey: mocks.fetchManagedKey,
  refreshPasskeySession: mocks.refreshPasskeySession
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
const MANAGED_KEY = 'a'.repeat(64)

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
  mocks.createNsecSigner.mockReturnValue(STUB_SIGNER)
  mocks.hasBrowserExtension.mockReturnValue(false)
})

describe('AuthProvider passkey sessions', () => {
  describe('loginWithToken', () => {
    it('commits a passkey session, never persists a secret, and hydrates the signer async', async () => {
      mocks.fetchManagedKey.mockResolvedValue({
        signerKey: MANAGED_KEY,
        pubkey: PUBKEY
      })

      renderProvider()
      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent(
          'unauthenticated'
        )
      )

      await act(async () => {
        await held.ctx!.loginWithToken('tok', 'passkey')
      })

      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      expect(screen.getByTestId('pubkey')).toHaveTextContent(PUBKEY)
      expect(screen.getByTestId('method')).toHaveTextContent('passkey')
      expect(localStorage.getItem(JWT_KEY)).toBe('tok')
      expect(localStorage.getItem(METHOD_KEY)).toBe('passkey')
      // The server custodies the key — nothing key-shaped may sit at rest.
      expect(localStorage.getItem(SECRET_KEY)).toBeNull()

      // No signerKey in the session response → async managed-key hydration.
      await waitFor(() =>
        expect(screen.getByTestId('signer')).toHaveTextContent('yes')
      )
      expect(mocks.fetchManagedKey).toHaveBeenCalledWith('tok')
      expect(mocks.createNsecSigner).toHaveBeenCalledWith(MANAGED_KEY)
    })

    it('builds the signer synchronously from signerKey and skips fetchManagedKey', async () => {
      mocks.fetchManagedKey.mockResolvedValue(null)

      renderProvider()
      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent(
          'unauthenticated'
        )
      )

      await act(async () => {
        await held.ctx!.loginWithToken('tok', 'passkey', MANAGED_KEY)
      })

      // Signer present immediately — no async hydration round trip.
      expect(screen.getByTestId('signer')).toHaveTextContent('yes')
      expect(mocks.createNsecSigner).toHaveBeenCalledWith(MANAGED_KEY)
      expect(localStorage.getItem(SECRET_KEY)).toBeNull()

      await flush()
      expect(mocks.fetchManagedKey).not.toHaveBeenCalled()
    })
  })

  describe('reload restore', () => {
    it('restores a managed-custody session: validateJwt then silent signer re-fetch', async () => {
      localStorage.setItem(JWT_KEY, 'stored-tok')
      localStorage.setItem(METHOD_KEY, 'passkey')
      mocks.fetchManagedKey.mockResolvedValue({
        signerKey: MANAGED_KEY,
        pubkey: PUBKEY
      })

      renderProvider()

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      )
      expect(mocks.validateJwt).toHaveBeenCalledWith('stored-tok')
      expect(screen.getByTestId('method')).toHaveTextContent('passkey')

      await waitFor(() =>
        expect(screen.getByTestId('signer')).toHaveTextContent('yes')
      )
      expect(mocks.fetchManagedKey).toHaveBeenCalledWith('stored-tok')
      expect(mocks.createNsecSigner).toHaveBeenCalledWith(MANAGED_KEY)
      // Restore never writes the key to disk either.
      expect(localStorage.getItem(SECRET_KEY)).toBeNull()
    })

    it('keeps a linked-custody session alive signer-less when fetchManagedKey returns null', async () => {
      localStorage.setItem(JWT_KEY, 'stored-tok')
      localStorage.setItem(METHOD_KEY, 'passkey')
      mocks.fetchManagedKey.mockResolvedValue(null)

      renderProvider()

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      )
      await flush()

      // Session survives; the signer simply stays empty (unlock on demand).
      expect(mocks.fetchManagedKey).toHaveBeenCalledWith('stored-tok')
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      expect(screen.getByTestId('signer')).toHaveTextContent('no')
      expect(mocks.createNsecSigner).not.toHaveBeenCalled()
      expect(localStorage.getItem(JWT_KEY)).toBe('stored-tok')
    })
  })

  describe('requestSigner silent branch', () => {
    it('rebuilds the signer from the managed key without opening the unlock dialog', async () => {
      localStorage.setItem(JWT_KEY, 'stored-tok')
      localStorage.setItem(METHOD_KEY, 'passkey')
      // Mount-time restore fails (network hiccup) → session stays signer-less;
      // the on-demand requestSigner() retry then succeeds silently.
      mocks.fetchManagedKey
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue({ signerKey: MANAGED_KEY, pubkey: PUBKEY })

      renderProvider()

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated')
      )
      await flush()
      expect(screen.getByTestId('signer')).toHaveTextContent('no')

      let signer: NostrSigner | null = null
      await act(async () => {
        signer = await held.ctx!.requestSigner()
      })

      expect(signer).toBe(STUB_SIGNER)
      expect(mocks.fetchManagedKey).toHaveBeenCalledTimes(2)
      expect(mocks.createNsecSigner).toHaveBeenCalledWith(MANAGED_KEY)
      await waitFor(() =>
        expect(screen.getByTestId('signer')).toHaveTextContent('yes')
      )
    })
  })
})
