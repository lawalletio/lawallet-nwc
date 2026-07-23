import {
  browserSupportsWebAuthn,
  startRegistration
} from '@simplewebauthn/browser'
import { finalizeEvent } from 'nostr-tools/pure'
import type { PasskeyCredentialSummary } from '@/lib/validation/schemas'
import { getPublicKeyFromPrivate, hexToNsec } from '@/lib/nostr'
import { derivePrfNsecHex, getPrfAssertion } from '@/lib/client/passkey-prf'

export type { PasskeyCredentialSummary }

/**
 * Client side of passkey auth under the PRF model: the WebAuthn PRF
 * extension (evaluated with a fixed app salt) deterministically derives the
 * credential's Nostr secret key CLIENT-SIDE — the server only records
 * credentials and never holds a key. Login is therefore a local ceremony
 * (PRF → nsec) followed by the ordinary NIP-98 → /api/jwt exchange.
 *
 * Every ceremony helper must be called from a user gesture (click handler) —
 * Safari/iOS reject WebAuthn calls outside transient activation.
 */

/** A passkey resolved to its deterministic Nostr identity. */
export interface PasskeyIdentity {
  /** 64-char hex secret key — what the signer and stored secret use. */
  secretHex: string
  /** bech32 nsec of the same key — for display/backup UI. */
  nsec: string
  pubkey: string
  credentialId: string
}

export type PasskeyErrorKind =
  | 'cancelled'
  | 'duplicate'
  | 'unsupported'
  | 'prf-unsupported'
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
      case 'PrfUnsupportedError':
        return new PasskeyError(
          'prf-unsupported',
          'This passkey cannot derive a key on this device — use iOS 18+/macOS 15+, a recent Chrome/Android, or another login method',
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

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * The registration ceremony shared by signup and add-a-passkey: create the
 * credential (requiring PRF support), evaluate the PRF against the fixed
 * salt, derive the key, and prove it to the server with a NIP-42 event
 * answering the WebAuthn challenge. The server records the credential and —
 * depending on `token` — creates the account (signup) or links the derived
 * pubkey as a secondary identity (add).
 */
async function runRegistrationCeremony(
  label?: string,
  token?: string
): Promise<PasskeyIdentity & { credential: PasskeyCredentialSummary }> {
  const { options } = await postJson<{
    options: { challenge: string } & Record<string, unknown>
  }>(
    '/api/auth/passkey/registration/options',
    label ? { label } : {},
    token
  )

  // Ask for the PRF extension at creation so `prf.enabled` tells us up front
  // whether this authenticator can derive keys at all.
  const optionsWithPrf = {
    ...options,
    extensions: {
      ...(options.extensions as Record<string, unknown> | undefined),
      prf: {}
    }
  }

  let registration
  try {
    registration = await startRegistration({
      optionsJSON: optionsWithPrf as never
    })
  } catch (err) {
    throw translatePasskeyError(err)
  }

  const prfEnabled = (
    registration.clientExtensionResults as { prf?: { enabled?: boolean } }
  ).prf?.enabled
  if (!prfEnabled) {
    throw new PasskeyError(
      'prf-unsupported',
      'This passkey cannot derive a key on this device — use iOS 18+/macOS 15+, a recent Chrome/Android, or another login method'
    )
  }

  // Evaluate the PRF with a second (pinned) ceremony and derive the key.
  let identity: PasskeyIdentity
  try {
    const assertion = await getPrfAssertion(registration.id)
    const secretHex = await derivePrfNsecHex(assertion.prfOutput)
    identity = {
      secretHex,
      nsec: hexToNsec(secretHex),
      pubkey: getPublicKeyFromPrivate(secretHex),
      credentialId: assertion.credentialId
    }
  } catch (err) {
    throw translatePasskeyError(err)
  }

  // Prove the derived key: kind-22242 answering the WebAuthn challenge.
  const proof = finalizeEvent(
    {
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['challenge', options.challenge]],
      content: ''
    },
    hexToBytes(identity.secretHex)
  )

  const { credential } = await postJson<{
    pubkey: string
    credential: PasskeyCredentialSummary
  }>(
    '/api/auth/passkey/registration/verify',
    {
      challenge: options.challenge,
      credential: registration,
      pubkey: identity.pubkey,
      proof,
      ...(label ? { label } : {})
    },
    token
  )

  return { ...identity, credential }
}

/**
 * Creates a brand-new passkey account: registers the credential, derives its
 * Nostr identity via PRF, and registers the account server-side. The caller
 * completes login with the ordinary NIP-98 exchange using `secretHex`.
 */
export function registerPasskeyAccount(
  label?: string
): Promise<PasskeyIdentity & { credential: PasskeyCredentialSummary }> {
  return runRegistrationCeremony(label)
}

/**
 * Passkey login — fully client-side: a discoverable assertion evaluates the
 * PRF and the same nsec falls out every time. No server round trip; the
 * caller logs in via NIP-98 with the derived key, which resolves to the
 * account that pubkey is linked to.
 */
export async function authenticateWithPasskey(): Promise<PasskeyIdentity> {
  try {
    const assertion = await getPrfAssertion()
    const secretHex = await derivePrfNsecHex(assertion.prfOutput)
    return {
      secretHex,
      nsec: hexToNsec(secretHex),
      pubkey: getPublicKeyFromPrivate(secretHex),
      credentialId: assertion.credentialId
    }
  } catch (err) {
    throw translatePasskeyError(err)
  }
}

/**
 * Adds a passkey to the CURRENT account: same ceremony as signup, but the
 * authenticated verify links the derived pubkey as a secondary identity.
 * 409 → 'duplicate' (credential already registered / pubkey owned by another
 * account) — the UI surfaces the merge suggestion.
 */
export async function linkPasskey(
  token: string,
  label?: string
): Promise<PasskeyCredentialSummary> {
  const result = await runRegistrationCeremony(label, token)
  return result.credential
}
