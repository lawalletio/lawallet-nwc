import { LaWalletClient, nsecSigner, toNpub } from '@lawallet-nwc/sdk'

/**
 * The ONE place the admin key is read.
 *
 * `LAWALLET_ADMIN_NSEC` has no `VITE_` prefix, so Vite will not inline it into
 * the browser bundle — the key is structurally incapable of reaching a client.
 * Keep it that way: never import this module from anything under `src/`.
 */

export type AdminAuthMode = 'nip98' | 'jwt'

export interface AdminClientOptions {
  endpoint: string
  nsec: string
  authMode: AdminAuthMode
  /** Session lifetime requested in `jwt` mode. Capped at 24h by the API. */
  jwtExpiresIn?: string
}

const JWT_RENEW_MARGIN_MS = 60_000

/**
 * Returns a LaWalletClient authenticated as the admin, in whichever mode is
 * configured:
 *
 * - `nip98` — every request is signed with the admin key. Works on every
 *   endpoint, including the few that only accept NIP-98.
 * - `jwt`   — one session token is minted (itself via NIP-98) and reused as a
 *   Bearer credential. `/api/jwt` is rate limited to 10/min per IP, so the
 *   token is cached and only re-minted near expiry — never per request.
 *
 * Both are genuine admin credentials: the API re-resolves the role from the
 * database on every request rather than trusting a claim in the token.
 */
export function createAdminClient(options: AdminClientOptions) {
  const signer = nsecSigner(options.nsec)
  const base = { endpoint: options.endpoint, signer }

  if (options.authMode === 'nip98') {
    const client = new LaWalletClient(base)
    return {
      authMode: 'nip98' as const,
      npub: async () => toNpub(await signer.getPublicKey()),
      get: async () => client
    }
  }

  let cached: { client: LaWalletClient; expiresAt: number } | null = null

  return {
    authMode: 'jwt' as const,
    npub: async () => toNpub(await signer.getPublicKey()),
    get: async () => {
      if (cached && Date.now() < cached.expiresAt - JWT_RENEW_MARGIN_MS) {
        return cached.client
      }

      // Minting is itself a NIP-98 call, so it needs the signer.
      const minter = new LaWalletClient(base)
      const { token } = await minter.auth.mintJwt(options.jwtExpiresIn ?? '12h')

      // A signer takes precedence over a token, so the session client is
      // built without one — proving the Bearer path really is in use.
      const client = new LaWalletClient({
        endpoint: options.endpoint,
        token
      })
      cached = { client, expiresAt: expiryOf(token) }
      return client
    }
  }
}

/** Reads `exp` out of a JWT payload without verifying it (we just minted it). */
function expiryOf(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    )
    if (typeof payload.exp === 'number') return payload.exp * 1000
  } catch {
    // Unreadable payload — fall through to a conservative default.
  }
  return Date.now() + 5 * 60_000
}
