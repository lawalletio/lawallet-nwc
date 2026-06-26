/**
 * Dev-only user impersonation. Mirrors the "Login as admin" flow: mint a
 * session JWT for a target pubkey via `/api/dev/impersonate` (404 in
 * production), swap it into the same localStorage slots the AuthProvider
 * rehydrates from, and reload. The previous session is stashed so it can be
 * restored ("Stop impersonating").
 *
 * Everything here is a no-op outside `development` — the API is double-gated.
 */

// Must match the keys AuthProvider reads on rehydrate (auth-context.tsx).
const JWT_KEY = 'lawallet-jwt'
const METHOD_KEY = 'lawallet-login-method'
const SECRET_KEY = 'lawallet-signer-secret'
const RETURN_KEY = 'lawallet-impersonator-return'

export function isDevEnv(): boolean {
  return process.env.NODE_ENV === 'development'
}

/** True when the current session is an impersonation that can be reverted. */
export function isImpersonating(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(RETURN_KEY) !== null
}

/**
 * Mint + apply an impersonation session for `pubkey`. Caller should reload
 * (e.g. `window.location.href = '/wallet'`) so the AuthProvider rehydrates.
 */
export async function startImpersonation(pubkey: string): Promise<void> {
  const res = await fetch('/api/dev/impersonate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pubkey }),
  })
  if (!res.ok) throw new Error(`impersonate failed (${res.status})`)
  const { token } = (await res.json()) as { token: string }

  // Stash the real session once, so chained impersonations don't bury it.
  if (!localStorage.getItem(RETURN_KEY)) {
    localStorage.setItem(
      RETURN_KEY,
      JSON.stringify({
        jwt: localStorage.getItem(JWT_KEY),
        method: localStorage.getItem(METHOD_KEY),
        secret: localStorage.getItem(SECRET_KEY),
      }),
    )
  }

  // Pure-JWT session for the impersonated identity — no signer to rebuild.
  localStorage.setItem(JWT_KEY, token)
  localStorage.removeItem(METHOD_KEY)
  localStorage.removeItem(SECRET_KEY)
}

/** Restore the stashed pre-impersonation session. Caller should reload. */
export function stopImpersonation(): void {
  const raw = localStorage.getItem(RETURN_KEY)
  if (!raw) return

  let prev: { jwt?: string | null; method?: string | null; secret?: string | null } = {}
  try {
    prev = JSON.parse(raw)
  } catch {
    /* fall through with empty prev → just clears the impersonation session */
  }

  const restore = (key: string, value: string | null | undefined) => {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  }
  restore(JWT_KEY, prev.jwt)
  restore(METHOD_KEY, prev.method)
  restore(SECRET_KEY, prev.secret)
  localStorage.removeItem(RETURN_KEY)
}
