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

// sha256('lawallet-nsec-prf-v1') — precomputed so the constant is visibly
// static rather than depending on runtime hashing.
export const PRF_SALT_HEX =
  '8ee22949c1045c627e14236f1d06cf730b46b4cf309cbf4ede25a446cf33ad8d'

const HKDF_INFO = 'lawallet-nsec-v1'

export function prfSaltBytes(): Uint8Array {
  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(PRF_SALT_HEX.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Derives the 64-char hex Nostr secret key from a PRF output.
 * HKDF-SHA256(ikm = prfOutput, salt = PRF_SALT, info = 'lawallet-nsec-v1')
 * → 32 bytes. The caller validates the scalar (e.g. by deriving the pubkey);
 * an out-of-range output has probability ≈ 2⁻¹²⁸ and surfaces as an error
 * rather than a silent retry, so derivation stays a pure function.
 */
export async function derivePrfNsecHex(
  prfOutput: ArrayBuffer | Uint8Array
): Promise<string> {
  const ikm =
    prfOutput instanceof Uint8Array ? toArrayBuffer(prfOutput) : prfOutput
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, [
    'deriveBits'
  ])
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: toArrayBuffer(prfSaltBytes()),
      info: toArrayBuffer(new TextEncoder().encode(HKDF_INFO))
    },
    key,
    256
  )
  return Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength
  ) as ArrayBuffer
}

function base64urlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

function bytesToBase64url(bytes: Uint8Array): string {
  let raw = ''
  for (const b of bytes) raw += String.fromCharCode(b)
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface PrfAssertion {
  prfOutput: ArrayBuffer
  /** base64url credential id that produced the output. */
  credentialId: string
}

/**
 * Runs a WebAuthn assertion purely to evaluate the PRF — the server is not
 * involved and the challenge is local randomness (the PRF result depends
 * only on the credential and the salt, never on the challenge). Uses the
 * raw API instead of @simplewebauthn/browser because its JSON serializer
 * drops ArrayBuffer extension outputs (the PRF result would arrive as {}).
 *
 * Omitting `credentialIdB64u` runs a discoverable ceremony (the platform
 * account picker); passing it pins the just-created credential.
 *
 * Throws `{ name: 'PrfUnsupportedError' }` when the authenticator did not
 * evaluate the PRF — the caller maps it to the 'prf-unsupported' error kind.
 */
export async function getPrfAssertion(
  credentialIdB64u?: string
): Promise<PrfAssertion> {
  const challenge = new Uint8Array(32)
  crypto.getRandomValues(challenge)

  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: toArrayBuffer(challenge),
      rpId: window.location.hostname,
      userVerification: 'required',
      timeout: 300_000,
      ...(credentialIdB64u
        ? {
            allowCredentials: [
              {
                type: 'public-key' as const,
                id: toArrayBuffer(base64urlToBytes(credentialIdB64u))
              }
            ]
          }
        : {}),
      extensions: {
        prf: { eval: { first: toArrayBuffer(prfSaltBytes()) } }
      } as AuthenticationExtensionsClientInputs
    }
  })) as PublicKeyCredential | null

  if (!credential) {
    const err = new Error('Passkey ceremony returned no credential')
    err.name = 'NotAllowedError'
    throw err
  }

  const extensions = credential.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer | Uint8Array } }
  }
  const first = extensions.prf?.results?.first
  if (!first) {
    const err = new Error(
      'This passkey did not return a PRF result — the device or browser does not support key derivation'
    )
    err.name = 'PrfUnsupportedError'
    throw err
  }

  return {
    prfOutput: first instanceof Uint8Array ? toArrayBuffer(first) : first,
    credentialId: bytesToBase64url(new Uint8Array(credential.rawId))
  }
}
