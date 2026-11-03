/**
 * PRF-derived Nostr keys for passkey login.
 *
 * The WebAuthn `prf` extension evaluates a pseudo-random function inside the
 * authenticator, keyed to the credential: PRF(credential, salt) is stable
 * forever and never leaves the device unencrypted. We evaluate it with a
 * fixed app-wide salt and HKDF the output into a secp256k1 secret key — so
 * a passkey deterministically IS a Nostr identity, on every device the
 * credential syncs to, with the server never seeing or storing the key.
 *
 * ⚠️ CONSENSUS-CRITICAL CONSTANTS — frozen forever. Changing `PRF_SALT_HEX`
 * or `HKDF_INFO` (or the HKDF construction) changes the key every existing
 * passkey derives, orphaning every account created with one. The unit test
 * pins fixed vectors; if it fails after an edit here, revert the edit.
 */

import {
  isLaWalletHandle,
  LAWALLET_PASSKEY_PARAMETERS
} from '@/lib/passkey-handle'
import {
  deriveNostrKey,
  derivedPrfInput,
  bytesToHex,
  type DerivedParameterSet
} from '@nostr-wot/identity/vault'

// sha256('lawallet-nsec-prf-v1') — precomputed so the constant is visibly
// static rather than depending on runtime hashing.
export const PRF_SALT_HEX =
  '8ee22949c1045c627e14236f1d06cf730b46b4cf309cbf4ede25a446cf33ad8d'

export const prfSaltBytes = () => derivedPrfInput(LAWALLET_PASSKEY_PARAMETERS)

/** Preserve LaWallet's existing key derivation through the shared SDK. */
export async function derivePrfNsecHex(
  prfOutput: ArrayBuffer | Uint8Array,
  parameters: DerivedParameterSet = LAWALLET_PASSKEY_PARAMETERS
): Promise<string> {
  const { secret } = deriveNostrKey(
    prfOutput instanceof Uint8Array ? prfOutput : new Uint8Array(prfOutput),
    parameters
  )
  try {
    return bytesToHex(secret)
  } finally {
    secret.fill(0)
  }
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength
  ) as ArrayBuffer
}

export function base64urlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function bytesToBase64url(bytes: Uint8Array): string {
  let raw = ''
  for (const b of bytes) raw += String.fromCharCode(b)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface PrfAssertion {
  prfOutput: ArrayBuffer
  /** base64url credential id that produced the output. */
  credentialId: string
}

export interface PasskeyAssertionRequest {
  /** Defaults to this page's host, LaWallet's own RP. */
  rpId?: string
  /** Pins one credential; omitted runs a discoverable ceremony. */
  credentialId?: Uint8Array
  prf?: { first: Uint8Array; second?: Uint8Array }
  largeBlob?: { read: true } | { write: Uint8Array }
}

export interface PasskeyAssertionResult {
  rawId: Uint8Array
  /** base64url (no padding) of `rawId`, as WebAuthn and the server use it. */
  credentialId: string
  userHandle: Uint8Array | null
  /**
   * Views over the browser's own result buffers (no copies), so zeroing
   * them wipes the only copy. Callers zero them as soon as they are used.
   */
  prfFirst?: Uint8Array
  prfSecond?: Uint8Array
  blob?: Uint8Array
  written?: boolean
}

const view = (value?: ArrayBuffer | ArrayBufferView) =>
  value === undefined
    ? undefined
    : value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)

/**
 * One local WebAuthn assertion: the server is not involved and the
 * challenge is local randomness (PRF results and largeBlob contents depend
 * only on the credential, never on the challenge). Uses the raw API instead
 * of @simplewebauthn/browser because its JSON serializer drops ArrayBuffer
 * extension outputs.
 */
export async function passkeyAssertion(
  request: PasskeyAssertionRequest
): Promise<PasskeyAssertionResult> {
  const challenge = new Uint8Array(32)
  crypto.getRandomValues(challenge)

  const extensions: Record<string, unknown> = {}
  if (request.prf) {
    extensions.prf = {
      eval: {
        first: toArrayBuffer(request.prf.first),
        ...(request.prf.second
          ? { second: toArrayBuffer(request.prf.second) }
          : {})
      }
    }
  }
  if (request.largeBlob) {
    extensions.largeBlob =
      'write' in request.largeBlob
        ? { write: toArrayBuffer(request.largeBlob.write) }
        : { read: true }
  }

  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(challenge),
      rpId: request.rpId ?? window.location.hostname,
      userVerification: 'required',
      timeout: 300_000,
      ...(request.credentialId
        ? {
            allowCredentials: [
              {
                type: 'public-key' as const,
                id: toArrayBuffer(request.credentialId)
              }
            ]
          }
        : {}),
      extensions: extensions as AuthenticationExtensionsClientInputs
    }
  })) as PublicKeyCredential | null

  if (!credential) {
    const err = new Error('Passkey ceremony returned no credential')
    err.name = 'NotAllowedError'
    throw err
  }

  const { userHandle } = credential.response as AuthenticatorAssertionResponse
  const results = credential.getClientExtensionResults() as {
    prf?: {
      enabled?: boolean
      results?: {
        first?: ArrayBuffer | Uint8Array
        second?: ArrayBuffer | Uint8Array
      }
    }
    largeBlob?: { blob?: ArrayBuffer | Uint8Array; written?: boolean }
  }
  if (results.prf?.enabled === false) {
    view(results.prf.results?.first)?.fill(0)
    view(results.prf.results?.second)?.fill(0)
    throw prfUnsupportedError()
  }
  const rawId = new Uint8Array(credential.rawId)
  return {
    rawId,
    credentialId: bytesToBase64url(rawId),
    userHandle: userHandle ? new Uint8Array(userHandle) : null,
    prfFirst: view(results.prf?.results?.first),
    prfSecond: view(results.prf?.results?.second),
    blob: view(results.largeBlob?.blob),
    written: results.largeBlob?.written
  }
}

/**
 * Runs an assertion purely to evaluate LaWallet's derivation PRF.
 * Omitting `credentialIdB64u` runs a discoverable ceremony (the platform
 * account picker); passing it pins the just-created credential.
 *
 * Throws `{ name: 'PrfUnsupportedError' }` when the authenticator did not
 * evaluate the PRF — the caller maps it to the 'prf-unsupported' error kind.
 * Throws `{ name: 'ForeignPasskeyError' }` first when the user handle says
 * the passkey belongs to another app ('foreign-passkey').
 */
export async function getPrfAssertion(
  credentialIdB64u?: string
): Promise<PrfAssertion> {
  const assertion = await passkeyAssertion({
    ...(credentialIdB64u
      ? { credentialId: base64urlToBytes(credentialIdB64u) }
      : {}),
    prf: { first: prfSaltBytes() }
  })

  if (!isLaWalletHandle(assertion.userHandle)) {
    assertion.prfFirst?.fill(0)
    const err = new Error('This passkey belongs to another app')
    err.name = 'ForeignPasskeyError'
    throw err
  }

  const first = assertion.prfFirst
  if (!first) throw prfUnsupportedError()

  const prfOutput = toArrayBuffer(first)
  first.fill(0)
  return { prfOutput, credentialId: assertion.credentialId }
}

export function prfUnsupportedError(): Error {
  const err = new Error(
    'This passkey did not return a PRF result — the device or browser does not support key derivation'
  )
  err.name = 'PrfUnsupportedError'
  return err
}
