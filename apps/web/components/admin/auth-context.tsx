'use client'

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef
} from 'react'
import type { NostrSigner } from '@nostrify/nostrify'
import {
  Role,
  Permission,
  hasPermission as checkPermission
} from '@/lib/auth/permissions'
import { exchangeNip98ForJwt, validateJwt } from '@/lib/client/auth-api'
import { createApiClient, type ApiClient } from '@/lib/client/api-client'
import {
  isJwtDueForRefresh,
  isJwtExpired,
  SESSION_REFRESH_BUFFER_MS
} from '@/lib/client/jwt-expiry'
import {
  createBrowserSigner,
  createBunkerSigner,
  createNsecSigner,
  hasBrowserExtension
} from '@/lib/client/nostr-signer'
import {
  clearSessionCaches,
  waitForSessionCacheCleanup
} from '@/lib/client/cache/session-cache'
import { SignerUnlockDialog } from '@/components/admin/signer-unlock-dialog'
import { trackEvent } from '@/lib/analytics/gtag'
import { AnalyticsEvent } from '@/lib/analytics/events'

const JWT_STORAGE_KEY = 'lawallet-jwt'
const LOGIN_METHOD_KEY = 'lawallet-login-method'
/**
 * Stores the credentials needed to silently rebuild a signer on reload —
 * the nsec for `'nsec'`, the bunker URL for `'bunker'`. Extension signers
 * recreate themselves from `window.nostr` so we don't persist anything for
 * that method. Empty / missing key falls back to the unlock dialog flow.
 *
 * Security tradeoff: `localStorage` is readable from any script running on
 * the same origin. We accept that here so users stay signed in across
 * reloads — the user opted into this explicitly. A future iteration should
 * replace this with WebAuthn-encrypted storage or a passphrase wrap.
 *
 * `'passkey'` sessions store the PRF-DERIVED key here too — a passkey is
 * just a deterministic way to produce an nsec, so its session persists and
 * restores exactly like the nsec method.
 */
const SIGNER_SECRET_KEY = 'lawallet-signer-secret'
const IMPERSONATOR_RETURN_KEY = 'lawallet-impersonator-return'

async function restoreStoredSigner(
  storedMethod: LoginMethod | null
): Promise<NostrSigner | null> {
  let signer: NostrSigner | null = null
  const storedSecret = localStorage.getItem(SIGNER_SECRET_KEY)

  if (storedMethod === 'extension' && hasBrowserExtension()) {
    try {
      signer = createBrowserSigner()
    } catch {
      // Extension not available, continue without signer
    }
  } else if (storedMethod === 'nsec' && storedSecret) {
    try {
      signer = createNsecSigner(storedSecret)
    } catch {
      // Stored secret is malformed — drop it so we don't keep
      // failing on every reload.
      localStorage.removeItem(SIGNER_SECRET_KEY)
    }
  } else if (storedMethod === 'bunker' && storedSecret) {
    try {
      signer = await createBunkerSigner(storedSecret, { timeout: 15_000 })
    } catch {
      // Bunker relay unreachable or signer rejected the resume.
      // Keep the secret so a manual retry can pick it up later.
    }
  } else if (storedMethod === 'passkey' && storedSecret) {
    // A passkey session is an nsec session whose key came from the PRF
    // extension — restore it exactly like the nsec method.
    try {
      signer = createNsecSigner(storedSecret)
    } catch {
      localStorage.removeItem(SIGNER_SECRET_KEY)
    }
  }

  return signer
}

const EMPTY_AUTH_STATE: AuthState = {
  status: 'loading',
  jwt: null,
  pubkey: null,
  role: null,
  permissions: null,
  signer: null,
  loginMethod: null
}

declare global {
  interface Window {
    __lawalletHistoryRestoreGuardInstalled?: boolean
  }
}

export type LoginMethod = 'nsec' | 'bunker' | 'extension' | 'passkey'
export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated'

export interface AuthState {
  status: AuthStatus
  jwt: string | null
  pubkey: string | null
  role: Role | null
  permissions: Permission[] | null
  signer: NostrSigner | null
  loginMethod: LoginMethod | null
}

/**
 * Optional credentials the AuthProvider can persist so it can silently
 * rebuild a signer after a reload. The shape varies by method:
 * - `nsec`: the bech32 nsec (or 64-char hex) the user supplied
 * - `bunker`: the `bunker://…` URL with relay + secret
 * - `extension`: omit; recreated from `window.nostr`
 * - `passkey`: the PRF-derived 64-char hex key
 */
export interface SignerCredentials {
  secret: string
}

export interface AuthContextValue extends AuthState {
  login: (
    signer: NostrSigner,
    method: LoginMethod,
    credentials?: SignerCredentials
  ) => Promise<void>
  logout: () => void
  isAuthorized: (permission: Permission) => boolean
  apiClient: ApiClient
  /**
   * Returns the current signer if one is in memory, otherwise opens the
   * unlock dialog so the user can re-supply a nsec / bunker / extension
   * signer without going through a full JWT re-exchange. Rejects if the
   * user dismisses the dialog.
   */
  requestSigner: () => Promise<NostrSigner>
  /**
   * Re-mints the session token immediately so identity changes (new primary
   * pubkey, account merge) reflect without re-login. Resolves false when the
   * session has no way to re-mint (signer-less session) — pass a freshly
   * unlocked signer (from requestSigner()) to cover that case.
   */
  refreshSession: (signerOverride?: NostrSigner) => Promise<boolean>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}

function installHistoryRestoreGuard() {
  if (typeof window === 'undefined') return
  if (window.__lawalletHistoryRestoreGuardInstalled) return

  window.__lawalletHistoryRestoreGuardInstalled = true
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return
    if (!window.location.pathname.startsWith('/wallet')) return

    window.setTimeout(() => {
      const loadingIndicator = document.querySelector(
        '[role="progressbar"][aria-label="Loading"]'
      )
      const hasStoredJwt = Boolean(window.localStorage.getItem(JWT_STORAGE_KEY))

      if (loadingIndicator && hasStoredJwt) {
        window.location.reload()
      }
    }, 100)
  })
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(EMPTY_AUTH_STATE)

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Pending signer-unlock request. When set, the SignerUnlockDialog is
  // open and a previous `requestSigner()` caller is waiting on this
  // promise; resolved when the user supplies a new signer, rejected when
  // they dismiss the dialog.
  const [unlockOpen, setUnlockOpen] = useState(false)
  const unlockPromiseRef = useRef<{
    resolve: (signer: NostrSigner) => void
    reject: (err: Error) => void
  } | null>(null)

  // Latest in-memory signer, for callbacks that outlive their closure
  // (refreshSession after an account mutation, and silent remint on resume).
  const signerRef = useRef<NostrSigner | null>(null)

  // Resume / timer path. Assigned in the mount effect so the timer can call
  // the same ensureFreshSession() that visibility/pageshow/focus use.
  const ensureFreshSessionRef = useRef<() => Promise<void>>(async () => {})

  // Logout - clear everything
  const logout = useCallback(() => {
    trackEvent(AnalyticsEvent.LOGOUT)
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    localStorage.removeItem(JWT_STORAGE_KEY)
    localStorage.removeItem(LOGIN_METHOD_KEY)
    localStorage.removeItem(SIGNER_SECRET_KEY)
    localStorage.removeItem(IMPERSONATOR_RETURN_KEY)
    // Synchronous stores are gone before this returns. IndexedDB and browser
    // CacheStorage continue behind a barrier that the next login awaits.
    void clearSessionCaches()
    signerRef.current = null
    setState({
      status: 'unauthenticated',
      jwt: null,
      pubkey: null,
      role: null,
      permissions: null,
      signer: null,
      loginMethod: null
    })
  }, [])

  // Schedule a silent remint before expiry. Mobile PWAs suspend JS timers
  // while backgrounded, so this is a best-effort foreground helper — the
  // resume path in ensureFreshSession is what actually keeps the session.
  const scheduleRefresh = useCallback((expiresAt: string) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }

    const expiresMs = new Date(expiresAt).getTime()
    if (Number.isNaN(expiresMs)) return

    const delay = expiresMs - SESSION_REFRESH_BUFFER_MS - Date.now()
    // Already inside the buffer (or past it): don't spin a 0ms timer —
    // ensureFreshSession handles that on mount / visibility / focus.
    // Retry on a short backoff only while the token is still usable.
    const wait =
      delay > 0
        ? delay
        : Math.min(30_000, Math.max(5_000, expiresMs - Date.now()))
    if (wait <= 0) return

    refreshTimerRef.current = setTimeout(() => {
      void ensureFreshSessionRef.current()
    }, wait)
  }, [])

  // Login with a signer. When `credentials` is supplied we persist enough
  // to silently rebuild the signer on the next reload — the nsec for nsec
  // logins, the bunker URL for bunker logins. Extension callers omit it.
  const login = useCallback(
    async (
      signer: NostrSigner,
      method: LoginMethod,
      credentials?: SignerCredentials
    ) => {
      await waitForSessionCacheCleanup()
      const { token } = await exchangeNip98ForJwt(signer)
      const validation = await validateJwt(token)

      localStorage.setItem(JWT_STORAGE_KEY, token)
      localStorage.setItem(LOGIN_METHOD_KEY, method)
      if (credentials?.secret) {
        localStorage.setItem(SIGNER_SECRET_KEY, credentials.secret)
      } else {
        // Different login method — make sure stale credentials from a
        // previous account don't get re-applied on reload.
        localStorage.removeItem(SIGNER_SECRET_KEY)
      }

      signerRef.current = signer
      setState({
        status: 'authenticated',
        jwt: token,
        pubkey: validation.pubkey,
        role: validation.role,
        permissions: validation.permissions,
        signer,
        loginMethod: method
      })

      trackEvent(AnalyticsEvent.LOGIN_SUCCEEDED, {
        method,
        role: validation.role
      })

      scheduleRefresh(validation.expiresAt)
    },
    [scheduleRefresh]
  )

  // Re-mints the session token NOW and re-reads identity/role from it.
  // Used after account mutations that change what the session presents —
  // setting a new primary pubkey or merging accounts — so `pubkey`/`role`
  // update without a logout. Signer sessions (nsec/extension/bunker/passkey —
  // a passkey session restores a normal nsec signer) re-run the NIP-98
  // exchange. Signer-less sessions can't re-mint — the stale token stays (it
  // still authenticates; identity updates on next login) and we return false.
  const refreshSession = useCallback(
    async (signerOverride?: NostrSigner): Promise<boolean> => {
      // An explicit signer (e.g. one the caller just obtained via
      // requestSigner()) wins over the ref — the ref is synced from state in
      // an effect, so it can lag a just-unlocked signer by a render.
      const signer = signerOverride ?? signerRef.current

      let token: string | null = null
      if (signer) {
        token = (await exchangeNip98ForJwt(signer)).token
      }
      if (!token) return false

      const validation = await validateJwt(token)
      localStorage.setItem(JWT_STORAGE_KEY, token)
      if (signer) signerRef.current = signer
      setState(prev => ({
        ...prev,
        jwt: token,
        pubkey: validation.pubkey,
        role: validation.role,
        permissions: validation.permissions
      }))
      scheduleRefresh(validation.expiresAt)
      return true
    },
    [scheduleRefresh]
  )

  useEffect(() => {
    signerRef.current = state.signer
  }, [state.signer])

  // localStorage is shared across tabs. If one tab logs out, immediately tear
  // down the session in every other open tab as well so none can repopulate
  // user caches with requests from the identity that just signed out.
  useEffect(() => {
    function handleCrossTabLogout(event: StorageEvent) {
      if (
        event.storageArea === window.localStorage &&
        event.key === JWT_STORAGE_KEY &&
        event.newValue === null
      ) {
        logout()
      }
    }

    window.addEventListener('storage', handleCrossTabLogout)
    return () => window.removeEventListener('storage', handleCrossTabLogout)
  }, [logout])

  // Hydrate the session on mount and remint on resume. JWT expiry must not
  // wipe signer credentials — that's what made mobile PWAs look "logged out"
  // after the OS suspended the webview past the 24h token TTL.
  useEffect(() => {
    installHistoryRestoreGuard()

    let cancelled = false
    let inFlight: Promise<void> | null = null

    function dropJwtKeepCredentials() {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
      localStorage.removeItem(JWT_STORAGE_KEY)
      void clearSessionCaches()
      if (cancelled) return
      signerRef.current = null
      setState({
        status: 'unauthenticated',
        jwt: null,
        pubkey: null,
        role: null,
        permissions: null,
        signer: null,
        loginMethod: null
      })
    }

    async function remint(
      signer: NostrSigner,
      method: LoginMethod | null
    ): Promise<boolean> {
      const { token } = await exchangeNip98ForJwt(signer)
      const validation = await validateJwt(token)
      if (cancelled) return false
      localStorage.setItem(JWT_STORAGE_KEY, token)
      signerRef.current = signer
      setState({
        status: 'authenticated',
        jwt: token,
        pubkey: validation.pubkey,
        role: validation.role,
        permissions: validation.permissions,
        signer,
        loginMethod: method
      })
      scheduleRefresh(validation.expiresAt)
      return true
    }

    async function ensureFreshSession(source: 'hydrate' | 'resume') {
      if (cancelled) return
      if (inFlight) {
        await inFlight
        return
      }

      inFlight = (async () => {
        const storedToken = localStorage.getItem(JWT_STORAGE_KEY)
        const storedMethod = localStorage.getItem(
          LOGIN_METHOD_KEY
        ) as LoginMethod | null
        const impersonating = Boolean(
          localStorage.getItem(IMPERSONATOR_RETURN_KEY)
        )

        const resolveSigner = async () =>
          signerRef.current ?? (await restoreStoredSigner(storedMethod))

        // Dev impersonation is a pure-JWT session. Reminting with the
        // admin signer would swap identities; never do that.
        const canRemint = !impersonating

        if (!storedToken) {
          // Recover from a dropped JWT only on first hydrate. Retrying on
          // every window focus would hammer POST /api/jwt after a failed
          // remint (rate-limited at 10/min).
          if (canRemint && source === 'hydrate') {
            const signer = await resolveSigner()
            if (signer) {
              try {
                await remint(signer, storedMethod)
                return
              } catch {
                dropJwtKeepCredentials()
                return
              }
            }
          }
          if (cancelled) return
          setState(prev => ({
            ...prev,
            status: 'unauthenticated',
            signer: null
          }))
          return
        }

        const expired = isJwtExpired(storedToken)
        const dueForRefresh = isJwtDueForRefresh(storedToken)

        if (expired && !canRemint) {
          dropJwtKeepCredentials()
          return
        }

        if (canRemint && (expired || dueForRefresh)) {
          const signer = await resolveSigner()
          if (signer) {
            try {
              await remint(signer, storedMethod)
              return
            } catch {
              if (expired) {
                dropJwtKeepCredentials()
                return
              }
              // Token is still inside the buffer — fall through to validate.
            }
          } else if (expired) {
            dropJwtKeepCredentials()
            return
          }
        }

        try {
          const validation = await validateJwt(storedToken)
          if (cancelled) return

          const existingSigner = signerRef.current

          setState(prev => ({
            ...prev,
            status: 'authenticated',
            jwt: storedToken,
            pubkey: validation.pubkey,
            role: validation.role,
            permissions: validation.permissions,
            signer: prev.signer,
            loginMethod: storedMethod
          }))

          scheduleRefresh(validation.expiresAt)

          if (existingSigner) return

          const restored = await restoreStoredSigner(storedMethod)
          if (cancelled || !restored) return
          signerRef.current = restored
          setState(prev => {
            if (prev.jwt !== storedToken || prev.status !== 'authenticated') {
              return prev
            }
            return { ...prev, signer: restored, loginMethod: storedMethod }
          })

          if (
            canRemint &&
            new Date(validation.expiresAt).getTime() - Date.now() <=
              SESSION_REFRESH_BUFFER_MS
          ) {
            try {
              await remint(restored, storedMethod)
            } catch {
              // Keep the still-valid token; scheduleRefresh already armed.
            }
          }
        } catch {
          if (!canRemint) {
            dropJwtKeepCredentials()
            return
          }
          const signer = await resolveSigner()
          if (signer) {
            try {
              await remint(signer, storedMethod)
              return
            } catch {
              dropJwtKeepCredentials()
              return
            }
          }
          dropJwtKeepCredentials()
        }
      })()

      try {
        await inFlight
      } finally {
        inFlight = null
      }
    }

    ensureFreshSessionRef.current = () => ensureFreshSession('resume')

    function recheckAuthOnHistoryRestore(event: PageTransitionEvent) {
      if (!event.persisted) return
      void ensureFreshSession('resume')
    }

    function recheckAuthWhenVisible() {
      if (document.visibilityState !== 'visible') return
      void ensureFreshSession('resume')
    }

    function recheckAuthOnFocus() {
      void ensureFreshSession('resume')
    }

    void ensureFreshSession('hydrate')
    window.addEventListener('pageshow', recheckAuthOnHistoryRestore)
    document.addEventListener('visibilitychange', recheckAuthWhenVisible)
    window.addEventListener('focus', recheckAuthOnFocus)

    return () => {
      cancelled = true
      ensureFreshSessionRef.current = async () => {}
      window.removeEventListener('pageshow', recheckAuthOnHistoryRestore)
      document.removeEventListener('visibilitychange', recheckAuthWhenVisible)
      window.removeEventListener('focus', recheckAuthOnFocus)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    }
  }, [])

  // Permission check
  const isAuthorized = useCallback(
    (permission: Permission): boolean => {
      if (!state.role) return false
      return checkPermission(state.role, permission)
    },
    [state.role]
  )

  const requestSigner = useCallback((): Promise<NostrSigner> => {
    if (state.signer) return Promise.resolve(state.signer)

    const openUnlockDialog = () =>
      new Promise<NostrSigner>((resolve, reject) => {
        unlockPromiseRef.current = { resolve, reject }
        setUnlockOpen(true)
      })

    // Passkey sessions restore from the stored PRF-derived secret like any
    // nsec session; when it's gone (cleared storage) the dialog covers it.
    if (state.loginMethod === 'passkey') {
      const storedSecret = localStorage.getItem(SIGNER_SECRET_KEY)
      if (storedSecret) {
        try {
          const signer = createNsecSigner(storedSecret)
          signerRef.current = signer
          setState(prev => ({ ...prev, signer }))
          return Promise.resolve(signer)
        } catch {
          localStorage.removeItem(SIGNER_SECRET_KEY)
        }
      }
    }

    return openUnlockDialog()
  }, [state.signer, state.loginMethod])

  const handleUnlock = useCallback(
    (
      signer: NostrSigner,
      method: LoginMethod,
      credentials?: SignerCredentials
    ) => {
      // Keep localStorage aligned so future reloads pick the same method
      // and can silently re-create the signer.
      localStorage.setItem(LOGIN_METHOD_KEY, method)
      if (credentials?.secret) {
        localStorage.setItem(SIGNER_SECRET_KEY, credentials.secret)
      }
      signerRef.current = signer
      setState(prev => ({ ...prev, signer, loginMethod: method }))
      unlockPromiseRef.current?.resolve(signer)
      unlockPromiseRef.current = null
      setUnlockOpen(false)
    },
    []
  )

  const handleUnlockCancel = useCallback(() => {
    unlockPromiseRef.current?.reject(new Error('Signer unlock cancelled'))
    unlockPromiseRef.current = null
    setUnlockOpen(false)
  }, [])

  // API client bound to current JWT
  const apiClient = React.useMemo(
    () =>
      createApiClient({
        getToken: () => state.jwt,
        onUnauthorized: logout
      }),
    [state.jwt, logout]
  )

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    isAuthorized,
    apiClient,
    requestSigner,
    refreshSession
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SignerUnlockDialog
        open={unlockOpen}
        onCancel={handleUnlockCancel}
        onUnlock={handleUnlock}
      />
    </AuthContext.Provider>
  )
}
