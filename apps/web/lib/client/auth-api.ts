import type { NostrSigner } from '@nostrify/nostrify'
import { createNip98Token } from '@/lib/nip98'
import type { Role, Permission } from '@/lib/auth/permissions'

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

  const authHeader = await createNip98Token(url, { method: 'POST', body }, signer)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Authentication failed' } }))
    throw new Error(error.error?.message || `Authentication failed (${response.status})`)
  }

  return response.json()
}

/**
 * Validate an existing JWT token.
 * Returns user info (pubkey, role, permissions) if valid.
 */
export async function validateJwt(token: string): Promise<JwtValidation> {
  const response = await fetch('/api/jwt', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error('Invalid or expired token')
  }

  return response.json()
}

/**
 * Check if a root admin has been assigned.
 * Requires NIP-98 auth (not JWT).
 */
export async function checkRootStatus(signer: NostrSigner): Promise<RootStatus> {
  const url = `${window.location.origin}/api/admin/assign`
  const authHeader = await createNip98Token(url, { method: 'GET' }, signer)

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to check root status' } }))
    throw new Error(error.error?.message || 'Failed to check root status')
  }

  return response.json()
}

/**
 * Claim the root admin role. Only works if no root has been assigned yet.
 * Requires NIP-98 auth (not JWT).
 */
export async function claimRootRole(signer: NostrSigner): Promise<ClaimRootResponse> {
  const url = `${window.location.origin}/api/admin/assign`
  const authHeader = await createNip98Token(url, { method: 'POST' }, signer)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Failed to claim root role' } }))
    throw new Error(error.error?.message || 'Failed to claim root role')
  }

  return response.json()
}
