import type { NostrSigner } from '@nostrify/nostrify'
import type { Role, Permission } from '@/lib/auth/permissions'

const DEFAULT_AUTH_TIMEOUT_MS = 8_000

// Loaded on demand: NIP-98 signing pulls in nostr-tools, which the first
// paint of a stored session never needs.
async function createNip98Token(
  ...args: Parameters<typeof import('@/lib/nip98-client').createNip98Token>
) {
  const mod = await import('@/lib/nip98-client')
  return mod.createNip98Token(...args)
}

/**
 * The server answered GET /api/jwt with a non-2xx. `status` lets callers
 * tell a rejected token (401/403) apart from an outage (5xx, 429).
 */
export class JwtValidationError extends Error {
  constructor(readonly status: number) {
    super('Invalid or expired token')
    this.name = 'JwtValidationError'
  }
}

export interface JwtResponse {
  token: string
  expiresIn: string
  type: 'Bearer'
}

export interface JwtValidation {
  valid: boolean
  pubkey: string
  role: Role
  permissions: Permission[]
  issuedAt: string
  expiresAt: string
}

export interface RootStatus {
  isRoot: boolean
  hasRoot: boolean
  canAssignRoot: boolean
}

export interface ClaimRootResponse {
  message: string
  pubkey: string
}

/**
 * Exchange a NIP-98 signed event for a JWT token.
 * This is the primary login flow: Nostr signer → NIP-98 → JWT.
 */
export async function exchangeNip98ForJwt(
  signer: NostrSigner,
  expiresIn: string = '24h'
): Promise<JwtResponse> {
  const url = `${window.location.origin}/api/jwt`
  const body = JSON.stringify({ expiresIn })

  const authHeader = await createNip98Token(
    url,
    { method: 'POST', body },
    signer
  )

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json'
    },
    body
  })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: { message: 'Authentication failed' } }))
    throw new Error(
      error.error?.message || `Authentication failed (${response.status})`
    )
  }

  return response.json()
}

/**
 * Validate an existing JWT token.
 * Returns user info (pubkey, role, permissions) if valid.
 */
export async function validateJwt(
  token: string,
  opts: { timeoutMs?: number } = {}
): Promise<JwtValidation> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch('/api/jwt', {
      signal: controller.signal,
      cache: 'no-store',
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('JWT validation timed out')
    }
    throw err
  } finally {
    window.clearTimeout(timer)
  }

  if (!response.ok) {
    throw new JwtValidationError(response.status)
  }

  return response.json()
}

/**
 * Check if a root admin has been assigned.
 * Requires NIP-98 auth (not JWT).
 */
export async function checkRootStatus(
  signer: NostrSigner
): Promise<RootStatus> {
  const url = `${window.location.origin}/api/admin/assign`
  const authHeader = await createNip98Token(url, { method: 'GET' }, signer)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader
    }
  })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: { message: 'Failed to check root status' } }))
    throw new Error(error.error?.message || 'Failed to check root status')
  }

  return response.json()
}

/**
 * Claim the root admin role. Only works if no root has been assigned yet.
 * Requires NIP-98 auth (not JWT).
 */
export async function claimRootRole(
  signer: NostrSigner
): Promise<ClaimRootResponse> {
  const url = `${window.location.origin}/api/admin/assign`
  const authHeader = await createNip98Token(url, { method: 'POST' }, signer)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader
    }
  })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: { message: 'Failed to claim root role' } }))
    throw new Error(error.error?.message || 'Failed to claim root role')
  }

  return response.json()
}
