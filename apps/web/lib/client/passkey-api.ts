import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration
} from '@simplewebauthn/browser'
import type { PasskeyCredentialSummary } from '@/lib/validation/schemas'

export type { PasskeyCredentialSummary }

/**
 * Client side of the passkey (WebAuthn) auth flows. Each ceremony helper runs
 * the full begin → browser prompt → verify round trip and must be called from
 * a user gesture (click handler) — Safari/iOS reject WebAuthn calls outside
 * transient activation.
 */

export type PasskeyCustody = 'managed' | 'linked'

/** Session payload minted by the passkey auth endpoints (mirrors /api/jwt). */
export interface PasskeySession {
  token: string
  expiresIn: string | number
  type: 'Bearer'
  pubkey: string
  custody: PasskeyCustody
  /**
   * The account's Nostr private key (hex) — present ONLY on the response of
   * a brand-new registration, so the client can build its in-memory signer
   * without a second round trip. Never persisted.
   */
  signerKey?: string
}

export type PasskeyErrorKind =
  | 'cancelled'
  | 'duplicate'
  | 'unsupported'
  | 'security'
  | 'unknown'

export class PasskeyError extends Error {
  kind: PasskeyErrorKind

  constructor(kind: PasskeyErrorKind, message: string, cause?: unknown) {
    super(message)
    this.name = 'PasskeyError'
    this.kind = kind
    this.cause = cause
  }
}

/** Maps WebAuthn DOMExceptions / fetch failures to user-facing copy. */
export function translatePasskeyError(err: unknown): PasskeyError {
  if (err instanceof PasskeyError) return err

  if (err instanceof DOMException || (err instanceof Error && err.name)) {
    switch ((err as Error).name) {
      case 'NotAllowedError':
      case 'AbortError':
        // Covers user cancel AND ceremony timeout — silent-reset material.
        return new PasskeyError(
          'cancelled',
          'Passkey prompt was closed — try again',
          err
        )
      case 'InvalidStateError':
        return new PasskeyError(
          'duplicate',
          'This device already has a passkey for this account',
          err
        )
      case 'SecurityError':
        return new PasskeyError(
          'security',
          'Passkeys need a secure origin — use HTTPS (or localhost in dev; LAN IPs are rejected)',
          err
        )
      case 'NotSupportedError':
        return new PasskeyError(
          'unsupported',
          'This device does not support passkeys',
          err
        )
    }
  }

  const message =
    err instanceof Error && err.message ? err.message : 'Passkey request failed'
  return new PasskeyError('unknown', message, err)
}

/** SSR-safe support gate — render passkey UI only when this returns true. */
export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined' && browserSupportsWebAuthn()
}

async function postJson<T>(
  path: string,
  body?: unknown,
  token?: string
): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message =
      payload?.error?.message || `Request failed (${response.status})`
    throw new PasskeyError(
      response.status === 409 ? 'duplicate' : 'unknown',
      message
    )
  }

  return response.json()
}

/**
 * Creates a brand-new account with a passkey: the server generates and
 * custodies a Nostr key; the response carries the session JWT plus the key
 * (once) so the caller can build an in-memory signer immediately.
 */
export async function registerPasskeyAccount(
  label?: string
): Promise<PasskeySession> {
  const { options } = await postJson<{
    options: { challenge: string } & Record<string, unknown>
  }>('/api/auth/passkey/registration/options', label ? { label } : {})

  let credential
  try {
    credential = await startRegistration({ optionsJSON: options as never })
  } catch (err) {
    throw translatePasskeyError(err)
  }

  return postJson<PasskeySession>('/api/auth/passkey/registration/verify', {
    challenge: options.challenge,
    credential,
    ...(label ? { label } : {})
  })
}

/**
 * Runs ONLY the assertion ceremony (options + authenticator prompt) without
 * exchanging it for a session. Used when an assertion serves as proof of
 * account control — e.g. the account link/merge flow — where a different
 * endpoint consumes the challenge.
 */
export async function getPasskeyAssertion(): Promise<{
  challenge: string
  credential: unknown
}> {
  const { options } = await postJson<{
    options: { challenge: string } & Record<string, unknown>
  }>('/api/auth/passkey/authentication/options')

  let credential
  try {
    credential = await startAuthentication({ optionsJSON: options as never })
  } catch (err) {
    throw translatePasskeyError(err)
  }

  return { challenge: options.challenge, credential }
}

/** Username-less login with any passkey registered on this instance. */
export async function authenticateWithPasskey(): Promise<PasskeySession> {
  const { options } = await postJson<{
    options: { challenge: string } & Record<string, unknown>
  }>('/api/auth/passkey/authentication/options')

  let credential
  try {
    credential = await startAuthentication({ optionsJSON: options as never })
  } catch (err) {
    throw translatePasskeyError(err)
  }

  return postJson<PasskeySession>('/api/auth/passkey/authentication/verify', {
    challenge: options.challenge,
    credential
  })
}

/**
 * Fetches the server-custodied key for silent signer restore. Returns null
 * for linked-credential accounts (the server never had their key) — callers
 * fall back to the signer-unlock flow.
 */
export async function fetchManagedKey(
  token: string
): Promise<{ signerKey: string; pubkey: string } | null> {
  const response = await fetch('/api/auth/passkey/signer-key', {
    method: 'GET',
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` }
  })

  if (response.status === 404) return null
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new PasskeyError(
      'unknown',
      payload?.error?.message || `Request failed (${response.status})`
    )
  }

  return response.json()
}

/**
 * Explicit nsec export: requires a fresh passkey assertion on top of the
 * session token, so a stolen JWT alone can never exfiltrate the key.
 */
export async function exportManagedKey(
  token: string
): Promise<{ nsec: string; pubkey: string }> {
  const { options } = await postJson<{
    options: { challenge: string } & Record<string, unknown>
  }>('/api/auth/passkey/nsec/export/options', undefined, token)

  let credential
  try {
    credential = await startAuthentication({ optionsJSON: options as never })
  } catch (err) {
    throw translatePasskeyError(err)
  }

  return postJson<{ nsec: string; pubkey: string }>(
    '/api/auth/passkey/nsec/export',
    { challenge: options.challenge, credential },
    token
  )
}

/** Links a new passkey to the currently authenticated account. */
export async function linkPasskey(
  token: string,
  label?: string
): Promise<PasskeyCredentialSummary> {
  const { options } = await postJson<{
    options: { challenge: string } & Record<string, unknown>
  }>('/api/auth/passkey/link/options', label ? { label } : {}, token)

  let credential
  try {
    credential = await startRegistration({ optionsJSON: options as never })
  } catch (err) {
    throw translatePasskeyError(err)
  }

  const { credential: summary } = await postJson<{
    credential: PasskeyCredentialSummary
  }>(
    '/api/auth/passkey/link/verify',
    { challenge: options.challenge, credential, ...(label ? { label } : {}) },
    token
  )
  return summary
}

/**
 * Re-issues a passkey session JWT (linked-custody accounts have no signer to
 * run the NIP-98 refresh path). Server-capped at 30 days of total session age.
 */
export async function refreshPasskeySession(
  token: string
): Promise<PasskeySession> {
  return postJson<PasskeySession>(
    '/api/auth/passkey/session/refresh',
    undefined,
    token
  )
}
