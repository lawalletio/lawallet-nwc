'use client'

import { closePasskeyProviderSigner } from '@/lib/client/passkey-provider'

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef
} from 'react'
import type { NostrSigner } from '@nostrify/nostrify'
import {
  Role,
  Permission,
  hasPermission as checkPermission
} from '@/lib/auth/permissions'
import {
  exchangeNip98ForJwt,
  validateJwt,
  type JwtValidation
} from '@/lib/client/auth-api'
import dynamic from 'next/dynamic'
import { createApiClient, type ApiClient } from '@/lib/client/api-client'
import {
  isJwtDueForRefresh,
  isJwtExpired,
  readJwtPayload,
  SESSION_REFRESH_BUFFER_MS
} from '@/lib/client/jwt-expiry'
import {
  clearSessionCaches,
  waitForSessionCacheCleanup
} from '@/lib/client/cache/session-cache'
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
 * Legacy persistent sessions may still read this key. Passkey sign-in and
 * imported sessions use provider-local memory instead; they do not write
 * the signer secret or JWT here. Migrating existing saved secrets requires
 * a separate, explicit recovery-safe transition.
 */
const SIGNER_SECRET_KEY = 'lawallet-signer-secret'
const IMPERSONATOR_RETURN_KEY = 'lawallet-impersonator-return'

// Only mounted once a caller asks for a signer: the dialog pulls in the
// login forms and qrcode.react, which no first paint needs.
const SignerUnlockDialog = dynamic(
  () =>
    import('@/components/admin/signer-unlock-dialog').then(
      m => m.SignerUnlockDialog
    ),
  { ssr: false }
)

/** localStorage can throw (storage disabled, sandboxed iframe). */
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function hasRecoverableSession(): boolean {
  return Boolean(
    readStorage(SIGNER_SECRET_KEY) ||
    readStorage(LOGIN_METHOD_KEY) ||
    readStorage(IMPERSONATOR_RETURN_KEY)
  )
}

const ROLES = new Set<string>(Object.values(Role))
const PERMISSIONS = new Set<string>(Object.values(Permission))

/**
 * The claims GET /api/jwt would echo back, read straight from the stored
 * token without verifying it. Only decides which screen renders first —
 * every API call is still verified server-side. Returns null for tokens
 * that don't carry a usable identity (opaque / foreign tokens).
 */
function readSessionClaims(token: string): JwtValidation | null {
  const payload = readJwtPayload(token)
  if (!payload) return null
  const { pubkey, role, permissions, iat, exp } = payload
  if (
    typeof pubkey !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(pubkey) ||
    typeof role !== 'string' ||
    !ROLES.has(role) ||
    !Array.isArray(permissions) ||
    !permissions.every(p => PERMISSIONS.has(p)) ||
    typeof exp !== 'number'
  ) {
    return null
  }
  return {
    valid: true,
    pubkey,
    role: role as Role,
    permissions: permissions as Permission[],
    issuedAt: new Date(
      (typeof iat === 'number' ? iat : 0) * 1000
    ).toISOString(),
    expiresAt: new Date(exp * 1000).toISOString()
  }
}

/** Claims of a token the server just minted; asks the server only if opaque. */
async function claimsOf(token: string): Promise<JwtValidation> {
  return readSessionClaims(token) ?? (await validateJwt(token))
}

/**
 * Only a 401/403 from GET /api/jwt says the token is bad. Offline, timeouts,
 * aborted navigations and 5xx say nothing about it.
 */
function isAuthRejection(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status
  return status === 401 || status === 403
}

async function restoreStoredSigner(
  storedMethod: LoginMethod | null
): Promise<NostrSigner | null> {
  let signer: NostrSigner | null = null
  const storedSecret = readStorage(SIGNER_SECRET_KEY)
  if (!storedMethod || (storedMethod !== 'extension' && !storedSecret)) {
    return null
  }

  const {
    createBrowserSigner,
    createBunkerSigner,
    createNsecSigner,
    hasBrowserExtension
  } = await import('@/lib/client/nostr-signer')

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
  /** Keep this login and subsequent token refreshes in memory until logout or reload. */
  persistence?: 'memory'
  signal?: AbortSignal
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
      const hasStoredJwt = Boolean(readStorage(JWT_STORAGE_KEY))

      if (loadingIndicator && hasStoredJwt) {
        window.location.reload()
      }
    }, 100)
  })
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(EMPTY_AUTH_STATE)
  // Scoped to this provider: a reload/remount cannot restore a temporary token.
  const sessionStorage = useMemo(() => {
    let temporary = false
    let deadline = 0
    const memory = new Map<string, string>()
    return {
      read: (key: string) =>
        temporary ? (memory.get(key) ?? null) : readStorage(key),
      write: (key: string, value: string) => {
        if (temporary) {
          if (key !== SIGNER_SECRET_KEY) memory.set(key, value)
        } else localStorage.setItem(key, value)
      },
      remove: (key: string) => {
        memory.delete(key)
        localStorage.removeItem(key)
      },
      start: (inMemory: boolean, expiresAt: string) => {
        memory.clear()
        temporary = inMemory
        deadline = inMemory ? new Date(expiresAt).getTime() : 0
        if (inMemory) {
          for (const key of [
            JWT_STORAGE_KEY,
            LOGIN_METHOD_KEY,
            SIGNER_SECRET_KEY,
            IMPERSONATOR_RETURN_KEY
          ])
            localStorage.removeItem(key)
        }
      },
      isTemporary: () => temporary,
      expiresAt: () => deadline,
      isExpired: () =>
        temporary && (!Number.isFinite(deadline) || Date.now() >= deadline),
      clear: () => memory.clear()
    }
  }, [])

  const sessionGenerationRef = useRef(0)
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
  // Last token the server confirmed (minted it, or answered 200 on GET
  // /api/jwt). Resume skips the network only for this token — an
  // optimistic, never-confirmed token is re-checked on the next resume.
  const confirmedJwtRef = useRef<string | null>(null)

  // Resume / timer path. Assigned in the mount effect so the timer can call
  // the same ensureFreshSession() that visibility/pageshow/focus use.
  const ensureFreshSessionRef = useRef<() => Promise<void>>(async () => {})

  // Logout - clear everything
  const logout = useCallback(() => {
    sessionGenerationRef.current++
    trackEvent(AnalyticsEvent.LOGOUT)
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    sessionStorage.remove(JWT_STORAGE_KEY)
    sessionStorage.remove(LOGIN_METHOD_KEY)
    sessionStorage.remove(SIGNER_SECRET_KEY)
    sessionStorage.remove(IMPERSONATOR_RETURN_KEY)
    // Synchronous stores are gone before this returns. IndexedDB and browser
    // CacheStorage continue behind a barrier that the next login awaits.
    void clearSessionCaches()
    closePasskeyProviderSigner(signerRef.current)
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
  }, [sessionStorage])

  // Drop the JWT but keep signer credentials so the next hydrate can remint.
  // Used when a silent refresh fails and when another tab expires the token
  // without an explicit logout. Must not call logout() — that wipes secrets.
  const endSessionKeepCredentials = useCallback(() => {
    sessionGenerationRef.current++
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    sessionStorage.remove(JWT_STORAGE_KEY)
    void clearSessionCaches()
    closePasskeyProviderSigner(signerRef.current)
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
  }, [sessionStorage])

  // Schedule a silent remint before expiry. Mobile PWAs suspend JS timers
  // while backgrounded, so this is a best-effort foreground helper — the
  // resume path in ensureFreshSession is what actually keeps the session.
  const scheduleRefresh = useCallback(
    (expiresAt: string) => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }

      if (sessionStorage.isTemporary()) {
        const remaining = sessionStorage.expiresAt() - Date.now()
        if (!Number.isFinite(remaining) || remaining <= 0) {
          logout()
          return
        }
        // Never extend a temporary session when another token is minted.
        refreshTimerRef.current = setTimeout(
          logout,
          Math.min(remaining, 2_147_483_647)
        )
        return
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
    },
    [logout, sessionStorage]
  )

  // Login with a signer. When `credentials` is supplied we persist enough
  // to silently rebuild the signer on the next reload — the nsec for nsec
  // logins, the bunker URL for bunker logins. Extension callers omit it.
  const login = useCallback(
    async (
      signer: NostrSigner,
      method: LoginMethod,
      credentials?: SignerCredentials
    ) => {
      const generation = ++sessionGenerationRef.current
      credentials?.signal?.throwIfAborted()
      await waitForSessionCacheCleanup()
      credentials?.signal?.throwIfAborted()
      const { token } = await exchangeNip98ForJwt(signer)
      const validation = await claimsOf(token)

      credentials?.signal?.throwIfAborted()
      if (generation !== sessionGenerationRef.current)
        throw new Error('Session changed during sign-in')
      sessionStorage.start(
        credentials?.persistence === 'memory',
        validation.expiresAt
      )
      sessionStorage.write(JWT_STORAGE_KEY, token)
      sessionStorage.write(LOGIN_METHOD_KEY, method)
      if (credentials?.secret) {
        sessionStorage.write(SIGNER_SECRET_KEY, credentials.secret)
      } else {
        // Different login method — make sure stale credentials from a
        // previous account don't get re-applied on reload.
        sessionStorage.remove(SIGNER_SECRET_KEY)
      }

      if (signerRef.current !== signer)
        closePasskeyProviderSigner(signerRef.current)
      signerRef.current = signer
      confirmedJwtRef.current = token
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
    [scheduleRefresh, sessionStorage]
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
      if (sessionStorage.isExpired()) {
        logout()
        return false
      }
      const generation = sessionGenerationRef.current
      // An explicit signer (e.g. one the caller just obtained via
      // requestSigner()) wins over the ref — the ref is synced from state in
      // an effect, so it can lag a just-unlocked signer by a render.
      const signer = signerOverride ?? signerRef.current

      let token: string | null = null
      if (signer) {
        token = (await exchangeNip98ForJwt(signer)).token
      }
      if (!token) return false

      const validation = await claimsOf(token)
      if (generation !== sessionGenerationRef.current) return false
      if (sessionStorage.isExpired()) {
        logout()
        return false
      }
      sessionStorage.write(JWT_STORAGE_KEY, token)
      if (signer) signerRef.current = signer
      confirmedJwtRef.current = token
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
    [scheduleRefresh, sessionStorage, logout]
  )

  useEffect(() => {
    signerRef.current = state.signer
  }, [state.signer])

  // localStorage is shared across tabs. An explicit logout (JWT and
  // credentials both gone) must tear down every tab. A silent remint
  // failure only removes the JWT — keep credentials so hydrate can retry.
  useEffect(() => {
    function handleCrossTabLogout(event: StorageEvent) {
      if (
        event.storageArea === window.localStorage &&
        event.key === JWT_STORAGE_KEY &&
        event.newValue === null
      ) {
        if (hasRecoverableSession()) {
          endSessionKeepCredentials()
        } else {
          logout()
        }
      }
    }

    window.addEventListener('storage', handleCrossTabLogout)
    return () => window.removeEventListener('storage', handleCrossTabLogout)
  }, [logout, endSessionKeepCredentials])

  // Hydrate the session on mount and remint on resume. JWT expiry must not
  // wipe signer credentials — that's what made mobile PWAs look "logged out"
  // after the OS suspended the webview past the 24h token TTL.
  useEffect(() => {
    installHistoryRestoreGuard()

    let cancelled = false
    let inFlight: Promise<void> | null = null
    let replacedToken = false

    function noteIfTokenReplaced(expectedToken: string | null) {
      if (sessionStorage.read(JWT_STORAGE_KEY) === expectedToken) return false
      // A newer token landed mid-flight. Re-validate it once this check
      // finishes, instead of leaving status on "loading".
      replacedToken = true
      return true
    }

    function dropJwtKeepCredentials(expectedToken: string | null) {
      // A newer token may have been written while this check was in flight
      // (dev login replaces the JWT, then navigates). Only drop the one we
      // actually decided was unusable.
      if (noteIfTokenReplaced(expectedToken)) return
      endSessionKeepCredentials()
    }

    async function remint(
      signer: NostrSigner,
      method: LoginMethod | null
    ): Promise<boolean> {
      const generation = sessionGenerationRef.current
      const { token } = await exchangeNip98ForJwt(signer)
      const validation = await claimsOf(token)
      if (cancelled || generation !== sessionGenerationRef.current) return false
      sessionStorage.write(JWT_STORAGE_KEY, token)
      if (signerRef.current !== signer)
        closePasskeyProviderSigner(signerRef.current)
      signerRef.current = signer
      confirmedJwtRef.current = token
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

    // Marks `token` as the live session. A no-op when nothing changed, so
    // the background validation after an optimistic render doesn't
    // re-render every consumer.
    function applySession(
      token: string,
      session: JwtValidation,
      method: LoginMethod | null
    ) {
      setState(prev => {
        if (
          prev.status === 'authenticated' &&
          prev.jwt === token &&
          prev.pubkey === session.pubkey &&
          prev.role === session.role &&
          prev.loginMethod === method &&
          prev.permissions?.join() === session.permissions.join()
        ) {
          return prev
        }
        return {
          ...prev,
          status: 'authenticated',
          jwt: token,
          pubkey: session.pubkey,
          role: session.role,
          permissions: session.permissions,
          loginMethod: method
        }
      })
      scheduleRefresh(session.expiresAt)
    }

    async function restoreMissingSigner(
      token: string,
      method: LoginMethod | null
    ) {
      if (signerRef.current) return
      const restored = sessionStorage.isTemporary()
        ? null
        : await restoreStoredSigner(method)
      if (cancelled || !restored) return
      signerRef.current = restored
      setState(prev => {
        if (prev.jwt !== token || prev.status !== 'authenticated') return prev
        return { ...prev, signer: restored, loginMethod: method }
      })
    }

    async function ensureFreshSession(source: 'hydrate' | 'resume') {
      if (cancelled) return
      if (sessionStorage.isExpired()) {
        logout()
        return
      }
      if (inFlight) {
        await inFlight
        return
      }

      inFlight = (async () => {
        const storedToken = sessionStorage.read(JWT_STORAGE_KEY)
        const storedMethod = sessionStorage.read(
          LOGIN_METHOD_KEY
        ) as LoginMethod | null
        const impersonating = Boolean(
          sessionStorage.read(IMPERSONATOR_RETURN_KEY)
        )

        const resolveSigner = async () =>
          signerRef.current ??
          (sessionStorage.isTemporary()
            ? null
            : await restoreStoredSigner(storedMethod))

        // Dev impersonation is a pure-JWT session. Reminting with the
        // admin signer would swap identities; never do that.
        const canRemint = !impersonating && !sessionStorage.isTemporary()

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
                dropJwtKeepCredentials(storedToken)
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
          dropJwtKeepCredentials(storedToken)
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
                dropJwtKeepCredentials(storedToken)
                return
              }
              // Token is still inside the buffer — fall through to validate.
            }
          } else if (expired) {
            dropJwtKeepCredentials(storedToken)
            return
          }
        }

        // Resume (focus / visibility / bfcache) with the token we already
        // trust and nowhere near expiry: no network round-trip. A slow or
        // flaky network must never log the user out here.
        if (
          source === 'resume' &&
          !dueForRefresh &&
          storedToken === confirmedJwtRef.current
        ) {
          await restoreMissingSigner(storedToken, storedMethod)
          return
        }

        // Optimistic: an unexpired token carries the same claims GET
        // /api/jwt echoes back, so render the session now and validate
        // behind it. Server-side authorization is unchanged.
        const claims = readSessionClaims(storedToken)
        if (claims) applySession(storedToken, claims, storedMethod)

        let validation: JwtValidation
        try {
          validation = await validateJwt(storedToken)
        } catch (err) {
          if (cancelled) return
          if (noteIfTokenReplaced(storedToken)) return
          if (!isAuthRejection(err)) {
            // Offline, timeout, 5xx or a navigation abort — not a verdict on
            // the token. Keep it. Without readable claims there's no
            // identity to show, so fall back to signed-out (JWT kept).
            if (claims) {
              await restoreMissingSigner(storedToken, storedMethod)
            } else {
              setState(prev =>
                prev.status === 'loading'
                  ? { ...prev, status: 'unauthenticated', signer: null }
                  : prev
              )
            }
            return
          }
          // The server rejected the token: remint if we can, else drop it.
          if (canRemint) {
            const signer = await resolveSigner()
            if (signer) {
              try {
                await remint(signer, storedMethod)
                return
              } catch {
                // Fall through and drop the rejected token.
              }
            }
          }
          dropJwtKeepCredentials(storedToken)
          return
        }
        if (cancelled) return

        confirmedJwtRef.current = storedToken
        applySession(storedToken, validation, storedMethod)
        await restoreMissingSigner(storedToken, storedMethod)
      })()

      try {
        await inFlight
      } finally {
        inFlight = null
      }

      if (replacedToken && !cancelled) {
        replacedToken = false
        await ensureFreshSession(source)
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
      // Invalidate outstanding operations, not a captured DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sessionGenerationRef.current++
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
      sessionStorage.clear()
      closePasskeyProviderSigner(signerRef.current)
      signerRef.current = null
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    }
  }, [sessionStorage])

  // Permission check
  const isAuthorized = useCallback(
    (permission: Permission): boolean => {
      if (!state.role) return false
      return checkPermission(state.role, permission)
    },
    [state.role]
  )

  const requestSigner = useCallback(async (): Promise<NostrSigner> => {
    if (sessionStorage.isExpired()) {
      logout()
      throw new Error('Session expired. Sign in again.')
    }
    if (state.signer) return state.signer

    // Passkey sessions restore from the stored PRF-derived secret like any
    // nsec session; when it's gone (cleared storage) the dialog covers it.
    if (state.loginMethod === 'passkey') {
      const storedSecret = sessionStorage.read(SIGNER_SECRET_KEY)
      if (storedSecret) {
        const { createNsecSigner } = await import('@/lib/client/nostr-signer')
        try {
          const signer = createNsecSigner(storedSecret)
          signerRef.current = signer
          setState(prev => ({ ...prev, signer }))
          return signer
        } catch {
          sessionStorage.remove(SIGNER_SECRET_KEY)
        }
      }
    }

    return new Promise<NostrSigner>((resolve, reject) => {
      unlockPromiseRef.current = { resolve, reject }
      setUnlockOpen(true)
    })
  }, [state.signer, state.loginMethod, sessionStorage, logout])

  const handleUnlock = useCallback(
    (
      signer: NostrSigner,
      method: LoginMethod,
      credentials?: SignerCredentials
    ) => {
      // Keep localStorage aligned so future reloads pick the same method
      // and can silently re-create the signer.
      sessionStorage.write(LOGIN_METHOD_KEY, method)
      if (credentials?.secret) {
        sessionStorage.write(SIGNER_SECRET_KEY, credentials.secret)
      }
      signerRef.current = signer
      setState(prev => ({ ...prev, signer, loginMethod: method }))
      unlockPromiseRef.current?.resolve(signer)
      unlockPromiseRef.current = null
      setUnlockOpen(false)
    },
    [sessionStorage]
  )

  const handleUnlockCancel = useCallback(() => {
    unlockPromiseRef.current?.reject(new Error('Signer unlock cancelled'))
    unlockPromiseRef.current = null
    setUnlockOpen(false)
  }, [])

  // API client bound to current JWT
  const handleUnauthorized = useCallback(() => {
    const stored = sessionStorage.read(JWT_STORAGE_KEY)
    // Anonymous 401s must not wipe a token that was just written and isn't
    // in React state yet — that's the dev admin login race.
    if (stored && stored !== state.jwt) return
    if (hasRecoverableSession()) {
      endSessionKeepCredentials()
      return
    }
    logout()
  }, [state.jwt, endSessionKeepCredentials, logout, sessionStorage])

  const apiClient = useMemo(
    () =>
      createApiClient({
        getToken: () => state.jwt,
        onUnauthorized: handleUnauthorized
      }),
    [state.jwt, handleUnauthorized]
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      logout,
      isAuthorized,
      apiClient,
      requestSigner,
      refreshSession
    }),
    [
      state,
      login,
      logout,
      isAuthorized,
      apiClient,
      requestSigner,
      refreshSession
    ]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
      {unlockOpen && (
        <SignerUnlockDialog
          open
          onCancel={handleUnlockCancel}
          onUnlock={handleUnlock}
        />
      )}
    </AuthContext.Provider>
  )
}
