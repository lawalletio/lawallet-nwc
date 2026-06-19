'use client'

import { useState } from 'react'

/**
 * Dev-only "Login as admin" button rendered inside {@link DevBanner}. Mints an
 * ADMIN JWT via `/api/dev/login` (404 in production), stores it as the session
 * token, and lands on the admin dashboard.
 *
 * Self-contained on purpose: the dev banner renders *outside* the AuthProvider,
 * so this can't use `useAuth()`. Writing `lawallet-jwt` + reloading lets the
 * provider rehydrate the session from localStorage on the next mount.
 */
export function DevAdminLogin() {
  const [loading, setLoading] = useState(false)

  async function loginAsAdmin() {
    setLoading(true)
    try {
      const res = await fetch('/api/dev/login', { method: 'POST' })
      if (!res.ok) throw new Error(`dev login failed (${res.status})`)
      const { token } = await res.json()

      localStorage.setItem('lawallet-jwt', token)
      // Pure JWT session — drop any stored signer so the provider doesn't try
      // to rebuild one for this fake identity on rehydrate.
      localStorage.removeItem('lawallet-login-method')
      localStorage.removeItem('lawallet-signer-secret')

      window.location.href = '/admin'
    } catch (err) {
      setLoading(false)
      console.error('[dev] login as admin failed', err)
    }
  }

  return (
    <button
      type="button"
      onClick={loginAsAdmin}
      disabled={loading}
      className="rounded bg-black/80 px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-amber-300 transition-colors hover:bg-black disabled:opacity-50"
    >
      {loading ? 'Logging in…' : 'Login as admin'}
    </button>
  )
}
