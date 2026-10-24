import {
  browserSupportsWebAuthn,
  startRegistration
} from '@simplewebauthn/browser'
import { finalizeEvent } from 'nostr-tools/pure'
import {
  classifyPasskeyHandle,
  DEFAULT_DERIVED_PARAMETER_SET,
  derivedPrfInput
} from '@nostr-wot/identity/vault'
import type { PasskeyCredentialSummary } from '@/lib/validation/schemas'
import { getPublicKeyFromPrivate, hexToNsec } from '@/lib/nostr'
import {
  derivePrfNsecHex,
  getPrfAssertion,
  passkeyAssertion,
  prfSaltBytes,
  prfUnsupportedError,
  type PasskeyAssertionResult
} from '@/lib/client/passkey-prf'
import {
  LAWALLET_PASSKEY_PARAMETERS,
  isLaWalletHandle,
  storedHandleAuthor
} from '@/lib/passkey-handle'
import {
  bytesToHex,
  isStoredRecord,
  openStoredAccounts,
  storedPrfInput,
  wipeStoredAccounts,
  StoredKeyError
} from '@/lib/passkey-store'

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
  | 'foreign-passkey'
  | 'import-blocked'
  | 'import-derived'
  | 'import-unsupported'
  | 'stored-key-missing'
  | 'stored-key-invalid'
  | 'store-failed'
  | 'key-owned'
  | 'security'
  | 'unknown'

export class PasskeyError extends Error {
  kind: PasskeyErrorKind
  /** `message` is the server's own text — show it as-is, never localize. */
  fromServer = false

  constructor(kind: PasskeyErrorKind, message: string, cause?: unknown) {
    super(message)
    this.name = 'PasskeyError'
    this.kind = kind
    this.cause = cause
  }
}

// Third-party Android providers (Samsung Pass, some password managers) can
// store a passkey but not evaluate PRF, so name the fix, not the device.
const PRF_UNSUPPORTED_MESSAGE =
  "Your passkey provider can't create the key LaWallet needs. Use Google Password Manager or iCloud Keychain, or sign in another way."

// Deriving from another app's passkey would open an empty account.
const FOREIGN_PASSKEY_MESSAGE =
  "This passkey belongs to another app, so LaWallet can't sign in with it. Use a LaWallet passkey or sign in another way."

// Stored-mode failures, see docs/JWT_USAGE.md "Passkey Handles".
const STORED_MESSAGES = {
  'import-blocked':
    "Your browser could not access passkeys from that domain here. The domain must authorize this site's address, and your browser must support cross-site passkeys. Choose another source or sign in another way.",
  'import-derived':
    "This passkey creates its key itself, so it can't be moved to LaWallet. Export the key from the other app and sign in with it instead.",
  'import-unsupported':
    "LaWallet can't read the key in this passkey. Export the key from the other app and sign in with it instead.",
  'stored-key-missing':
    "The key for this passkey wasn't found. LaWallet did not create a new account.",
  'stored-key-invalid':
    "The key saved with this passkey doesn't match it, so LaWallet won't use it.",
  'store-failed':
    "Your passkey provider couldn't save the key, so nothing was saved. You can delete the new LaWallet passkey from your provider and try another one.",
  'key-owned':
    'This key already belongs to another LaWallet account. Sign out and sign in with it instead.'
} as const

export function storedPasskeyError(
  kind: keyof typeof STORED_MESSAGES,
  cause?: unknown
): PasskeyError {
  return new PasskeyError(kind, STORED_MESSAGES[kind], cause)
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
          'Passkey prompt was closed or timed out — try again',
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
          typeof window !== 'undefined' && window.isSecureContext === false
            ? 'Passkeys need a secure connection. Open this site with HTTPS or use localhost for development.'
            : 'The passkey domain does not authorize this page, or the browser rejected its security settings. Open the app on its official domain and try again.',
          err
        )
      case 'NotSupportedError':
        return new PasskeyError(
          'unsupported',
          'This device does not support passkeys',
          err
        )
      case 'PrfUnsupportedError':
        return new PasskeyError('prf-unsupported', PRF_UNSUPPORTED_MESSAGE, err)
      case 'ForeignPasskeyError':
        return new PasskeyError('foreign-passkey', FOREIGN_PASSKEY_MESSAGE, err)
      case 'StoredKeyError':
        return storedPasskeyError('stored-key-invalid', err)
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

export async function postJson<T>(
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
    const error = new PasskeyError(
      response.status === 409 ? 'duplicate' : 'unknown',
      message
    )
    error.fromServer = true
    throw error
  }

  return response.json()
}

/** Where a ceremony got to — tags the Sentry event so Android failures sort by step/provider. */
export interface CeremonyContext {
  step?: 'options' | 'create' | 'prf-eval' | 'source' | 'blob-write' | 'verify'
  attachment?: string
  prfEnabled?: boolean
  prfAtCreate?: boolean
}

/**
 * Runs a ceremony, translating any failure into a PasskeyError and reporting
 * it to Sentry (DSN-gated, fire-and-forget). Cancels report at `info`: on
 * Android `NotAllowedError` also covers provider failures and a missing
 * screen lock, so they stay visible without paging anyone.
 */
export async function reported<T>(
  phase: 'register' | 'link' | 'authenticate' | 'import',
  run: (ctx: CeremonyContext) => Promise<T>
): Promise<T> {
  const ctx: CeremonyContext = {}
  try {
    return await run(ctx)
  } catch (err) {
    const error = translatePasskeyError(err)
    if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
      const cause = error.cause instanceof Error ? error.cause : error
      import('@sentry/nextjs')
        .then(Sentry =>
          Sentry.captureException(cause, {
            level: error.kind === 'cancelled' ? 'info' : 'error',
            fingerprint: ['passkey', phase, error.kind, ctx.step ?? 'unknown'],
            tags: {
              area: 'passkey',
              'passkey.phase': phase,
              'passkey.kind': error.kind,
              'passkey.step': ctx.step,
              'passkey.error': cause.name
            },
            contexts: { passkey: { ...ctx } }
          })
        )
        .catch(() => {})
    }
    throw error
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Proves the passkey's Nostr key to the server with a NIP-42 event answering
 * the WebAuthn challenge, and records the credential. The server creates the
 * account (signup) or links the pubkey as a secondary identity (`token`).
 * The PRF output never reaches the server: only `prf.enabled` is sent.
 */
export async function submitRegistration(
  ctx: CeremonyContext,
  params: {
    challenge: string
    registration: Record<string, unknown>
    otherExtensions: Record<string, unknown>
    prfEnabled?: boolean
    secretHex: string
    pubkey: string
    label?: string
    token?: string
  }
): Promise<{ pubkey: string; credential: PasskeyCredentialSummary }> {
  const proof = finalizeEvent(
    {
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['challenge', params.challenge]],
      content: ''
    },
    hexToBytes(params.secretHex)
  )

  ctx.step = 'verify'
  return postJson<{
    pubkey: string
    credential: PasskeyCredentialSummary
  }>(
    '/api/auth/passkey/registration/verify',
    {
      challenge: params.challenge,
      credential: {
        ...params.registration,
        clientExtensionResults: {
          ...params.otherExtensions,
          ...(params.prfEnabled !== undefined
            ? { prf: { enabled: params.prfEnabled } }
            : {})
        }
      },
      pubkey: params.pubkey,
      proof,
      ...(params.label ? { label: params.label } : {})
    },
    params.token
  )
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
  ctx: CeremonyContext,
  label?: string,
  token?: string
): Promise<PasskeyIdentity & { credential: PasskeyCredentialSummary }> {
  ctx.step = 'options'
  const { options } = await postJson<{
    options: { challenge: string } & Record<string, unknown>
  }>('/api/auth/passkey/registration/options', label ? { label } : {}, token)

  // Ask for the PRF result at creation: providers that evaluate it here
  // (Google Password Manager, iCloud Keychain) need only ONE prompt. The
  // back-to-back second ceremony is what Android providers fumble most.
  const optionsWithPrf = {
    ...options,
    extensions: {
      ...(options.extensions as Record<string, unknown> | undefined),
      prf: { eval: { first: prfSaltBytes().buffer } }
    }
  }

  ctx.step = 'create'
  let registration
  try {
    registration = await startRegistration({
      optionsJSON: optionsWithPrf as never
    })
  } catch (err) {
    throw translatePasskeyError(err)
  }

  const { prf, ...otherExtensions } = registration.clientExtensionResults as {
    prf?: {
      enabled?: boolean
      results?: { first?: ArrayBuffer | Uint8Array }
    }
  }
  ctx.attachment = registration.authenticatorAttachment
  ctx.prfEnabled = prf?.enabled
  ctx.prfAtCreate = Boolean(prf?.results?.first)
  // Only an explicit `false` is conclusive — some Android providers omit
  // `enabled` yet still evaluate PRF on the follow-up assertion.
  if (prf?.enabled === false) {
    throw new PasskeyError('prf-unsupported', PRF_UNSUPPORTED_MESSAGE)
  }

  let identity: PasskeyIdentity
  try {
    let prfOutput = prf?.results?.first
    let credentialId = registration.id
    if (!prfOutput) {
      // No result at creation → evaluate with a second (pinned) ceremony.
      ctx.step = 'prf-eval'
      const assertion = await getPrfAssertion(registration.id)
      prfOutput = assertion.prfOutput
      credentialId = assertion.credentialId
    }
    const secretHex = await derivePrfNsecHex(prfOutput)
    identity = {
      secretHex,
      nsec: hexToNsec(secretHex),
      pubkey: getPublicKeyFromPrivate(secretHex),
      credentialId
    }
  } catch (err) {
    throw translatePasskeyError(err)
  }

  const { credential } = await submitRegistration(ctx, {
    challenge: options.challenge,
    registration: registration as unknown as Record<string, unknown>,
    otherExtensions,
    prfEnabled: prf?.enabled,
    secretHex: identity.secretHex,
    pubkey: identity.pubkey,
    label,
    token
  })

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
  return reported('register', ctx => runRegistrationCeremony(ctx, label))
}

/**
 * Evaluate the last successful derived format and stored mode together.
 * The handle determines the actual format; a mismatch gets one pinned retry.
 * Legacy LaWallet handles always retain parameter 02. PRF outputs are wiped.
 */
export async function resolvePasskeyIdentity(
  ctx: CeremonyContext = {}
): Promise<PasskeyIdentity> {
  ctx.step = 'prf-eval'
  // A performance hint only: the returned handle always determines derivation.
  let preferred = LAWALLET_PASSKEY_PARAMETERS
  try {
    if (localStorage.getItem('lawallet.passkey.parameters') === '1')
      preferred = DEFAULT_DERIVED_PARAMETER_SET
  } catch {
    /* Storage can be disabled. */
  }
  const assertion = await passkeyAssertion({
    prf: { first: derivedPrfInput(preferred), second: storedPrfInput() },
    largeBlob: { read: true }
  })
  try {
    const author = storedHandleAuthor(assertion.userHandle)
    if (author) return await openOwnStoredPasskey(assertion, author)

    const handle = classifyPasskeyHandle(assertion.userHandle)
    const parameters =
      handle.mode === 'derived' &&
      handle.parameterSet === DEFAULT_DERIVED_PARAMETER_SET.id
        ? DEFAULT_DERIVED_PARAMETER_SET
        : isLaWalletHandle(assertion.userHandle)
          ? LAWALLET_PASSKEY_PARAMETERS
          : null
    if (!parameters)
      throw new PasskeyError('foreign-passkey', FOREIGN_PASSKEY_MESSAGE)
    let retry: PasskeyAssertionResult | undefined
    try {
      if (parameters.id !== preferred.id || !assertion.prfFirst) {
        retry = await passkeyAssertion({
          credentialId: assertion.rawId,
          prf: { first: derivedPrfInput(parameters) }
        })
        if (
          bytesToHex(retry.rawId) !== bytesToHex(assertion.rawId) ||
          (retry.userHandle &&
            (!assertion.userHandle ||
              bytesToHex(retry.userHandle) !==
                bytesToHex(assertion.userHandle)))
        ) {
          throw new PasskeyError('foreign-passkey', FOREIGN_PASSKEY_MESSAGE)
        }
      }
      const output = (retry ?? assertion).prfFirst
      if (!output) throw prfUnsupportedError()
      const secretHex = await derivePrfNsecHex(output, parameters)
      try {
        localStorage.setItem(
          'lawallet.passkey.parameters',
          String(parameters.id)
        )
      } catch {
        /* Optional hint. */
      }
      return {
        secretHex,
        nsec: hexToNsec(secretHex),
        pubkey: getPublicKeyFromPrivate(secretHex),
        credentialId: assertion.credentialId
      }
    } finally {
      if (retry) wipeAssertion(retry)
    }
  } finally {
    wipeAssertion(assertion)
  }
}

export function wipeAssertion(assertion: PasskeyAssertionResult) {
  assertion.prfFirst?.fill(0)
  assertion.prfSecond?.fill(0)
}

/**
 * A stored passkey under LaWallet's own RP: its largeBlob holds the record
 * written when the key was imported. Some platforms skip extensions on a
 * discoverable request, so a missing result gets one pinned retry.
 */
async function openOwnStoredPasskey(
  assertion: PasskeyAssertionResult,
  author: string
): Promise<PasskeyIdentity> {
  let prf = assertion.prfSecond
  let blob = assertion.blob
  let retry: PasskeyAssertionResult | null = null
  if (!prf || !blob) {
    retry = await passkeyAssertion({
      credentialId: assertion.rawId,
      prf: { first: storedPrfInput() },
      largeBlob: { read: true }
    })
    prf = retry.prfFirst
    blob = retry.blob
  }
  try {
    if (!prf) throw prfUnsupportedError()
    if (!isStoredRecord(blob)) throw storedPasskeyError('stored-key-missing')
    const accounts = await openStoredAccounts(blob!, prf, {
      rpId: window.location.hostname,
      author,
      credentialId: assertion.rawId
    })
    try {
      const account = accounts.find(a => a.pubkey === author)!
      const secretHex = bytesToHex(account.secret)
      return {
        secretHex,
        nsec: hexToNsec(secretHex),
        pubkey: author,
        credentialId: assertion.credentialId
      }
    } finally {
      wipeStoredAccounts(accounts)
    }
  } catch (err) {
    if (err instanceof StoredKeyError) {
      throw storedPasskeyError('stored-key-invalid', err)
    }
    throw err
  } finally {
    if (retry) wipeAssertion(retry)
  }
}

/**
 * Passkey login — fully client-side: one assertion resolves the passkey's
 * key (derived or stored, see `resolvePasskeyIdentity`). No server round
 * trip; the caller logs in via NIP-98 with the key, which resolves to the
 * account that pubkey is linked to.
 */
export function authenticateWithPasskey(): Promise<PasskeyIdentity> {
  return reported('authenticate', ctx => resolvePasskeyIdentity(ctx))
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
  const result = await reported('link', ctx =>
    runRegistrationCeremony(ctx, label, token)
  )
  return result.credential
}
