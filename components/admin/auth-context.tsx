'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import type { NostrSigner } from '@nostrify/nostrify'
import { Role, Permission, hasPermission as checkPermission } from '@/lib/auth/permissions'
import { exchangeNip98ForJwt, validateJwt } from '@/lib/client/auth-api'
import { createApiClient, type ApiClient } from '@/lib/client/api-client'
import { createBrowserSigner, hasBrowserExtension } from '@/lib/client/nostr-signer'

const JWT_STORAGE_KEY = 'lawallet-jwt'
const LOGIN_METHOD_KEY = 'lawallet-login-method'

// How many ms before JWT expiry to trigger refresh
const REFRESH_BUFFER_MS = 5 * 60 * 1000

export type LoginMethod = 'nsec' | 'bunker' | 'extension'
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

export interface AuthContextValue extends AuthState {
  login: (signer: NostrSigner, method: LoginMethod) => Promise<void>
  logout: () => void
  isAuthorized: (permission: Permission) => boolean
  apiClient: ApiClient
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    jwt: null,
    pubkey: null,
    role: null,
    permissions: null,
    signer: null,
    loginMethod: null,
  })

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Logout - clear everything
  const logout = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    localStorage.removeItem(JWT_STORAGE_KEY)
    localStorage.removeItem(LOGIN_METHOD_KEY)
    setState({
      status: 'unauthenticated',
      jwt: null,
      pubkey: null,
      role: null,
      permissions: null,
      signer: null,
      loginMethod: null,
    })
  }, [])

  // Schedule token refresh before expiry
  const scheduleRefresh = useCallback(
    (expiresAt: string, signer: NostrSigner | null) => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }

      const expiresMs = new Date(expiresAt).getTime()
      const refreshAt = expiresMs - REFRESH_BUFFER_MS
      const delay = refreshAt - Date.now()

      if (delay <= 0) return // Already expired or about to

      refreshTimerRef.current = setTimeout(async () => {
        if (!signer) {
          // No signer available - can't refresh, force re-login
          logout()
          return
        }

        try {
          const { token } = await exchangeNip98ForJwt(signer)
          const validation = await validateJwt(token)
          localStorage.setItem(JWT_STORAGE_KEY, token)

          setState((prev) => ({
            ...prev,
            jwt: token,
            pubkey: validation.pubkey,
            role: validation.role,
            permissions: validation.permissions,
          }))

          scheduleRefresh(validation.expiresAt, signer)
        } catch {
          logout()
        }
      }, delay)
    },
    [logout]
  )

  // Login with a signer
  const login = useCallback(
    async (signer: NostrSigner, method: LoginMethod) => {
      const { token } = await exchangeNip98ForJwt(signer)
      const validation = await validateJwt(token)

      localStorage.setItem(JWT_STORAGE_KEY, token)
      localStorage.setItem(LOGIN_METHOD_KEY, method)

      setState({
        status: 'authenticated',
        jwt: token,
        pubkey: validation.pubkey,
        role: validation.role,
        permissions: validation.permissions,
        signer,
        loginMethod: method,
      })

      scheduleRefresh(validation.expiresAt, signer)
    },
    [scheduleRefresh]
  )

  // Check for existing JWT on mount
  useEffect(() => {
    async function checkExistingAuth() {
      const storedToken = localStorage.getItem(JWT_STORAGE_KEY)
      const storedMethod = localStorage.getItem(LOGIN_METHOD_KEY) as LoginMethod | null

      if (!storedToken) {
        setState((prev) => ({ ...prev, status: 'unauthenticated' }))
        return
      }

      try {
        const validation = await validateJwt(storedToken)

        // Try to restore signer for extension method
        let signer: NostrSigner | null = null
        if (storedMethod === 'extension' && hasBrowserExtension()) {
          try {
            signer = createBrowserSigner()
          } catch {
            // Extension not available, continue without signer
          }
        }

        setState({
          status: 'authenticated',
          jwt: storedToken,
          pubkey: validation.pubkey,
          role: validation.role,
          permissions: validation.permissions,
          signer,
          loginMethod: storedMethod,
        })

        scheduleRefresh(validation.expiresAt, signer)
      } catch {
        // Token invalid or expired
        localStorage.removeItem(JWT_STORAGE_KEY)
        localStorage.removeItem(LOGIN_METHOD_KEY)
        setState((prev) => ({ ...prev, status: 'unauthenticated' }))
      }
    }

    checkExistingAuth()
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

  // API client bound to current JWT
  const apiClient = React.useMemo(
    () =>
      createApiClient({
        getToken: () => state.jwt,
        onUnauthorized: logout,
      }),
    [state.jwt, logout]
  )

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    isAuthorized,
    apiClient,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
