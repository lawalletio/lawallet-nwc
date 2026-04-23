import type { LightningAddressMode } from '@/lib/generated/prisma'

/**
 * What the LUD-16 endpoint should actually do for a given address, resolved
 * from the address's `mode` + its connection graph. The GET (metadata) and
 * GET /cb (callback) routes both call `resolvePaymentRoute` so they stay in
 * lockstep — a clever mode can never be handled one way in metadata and
 * another in the callback.
 *
 * Kinds:
 *   - `idle`          address is deliberately disabled (`mode=IDLE`).
 *   - `alias`         forward LUD-16 to another LN address (`mode=ALIAS`).
 *   - `nwc`           issue an invoice via this NWC connection string.
 *                     Emitted for `CUSTOM_NWC` (uses the linked connection)
 *                     and `DEFAULT_NWC` (uses the user's primary, falling
 *                     back to the legacy `User.nwc` column for accounts
 *                     that predate the NWCConnection model).
 *   - `unconfigured`  mode requires a connection / redirect that isn't set
 *                     (e.g. DEFAULT_NWC but no primary, ALIAS without a
 *                     redirect target). Treated as 404 at the HTTP layer.
 */
export type PaymentRoute =
  | { kind: 'idle' }
  | { kind: 'alias'; redirect: string }
  | { kind: 'nwc'; connectionString: string }
  | { kind: 'unconfigured' }

export interface ResolvePaymentRouteInput {
  mode: LightningAddressMode
  redirect: string | null
  /** The NWCConnection linked to the address (for CUSTOM_NWC). */
  nwcConnection: { connectionString: string } | null
  /** The user's primary NWCConnection (for DEFAULT_NWC). */
  primaryNwcConnection: { connectionString: string } | null
  /**
   * Legacy single-NWC URI on `User.nwc`. Used as a last-resort fallback for
   * DEFAULT_NWC so accounts that haven't migrated to NWCConnection records
   * keep receiving payments. Pass `null` to disable the fallback.
   */
  userNwc: string | null
}

export function resolvePaymentRoute(input: ResolvePaymentRouteInput): PaymentRoute {
  switch (input.mode) {
    case 'IDLE':
      return { kind: 'idle' }
    case 'ALIAS':
      return input.redirect && input.redirect.trim().length > 0
        ? { kind: 'alias', redirect: input.redirect.trim() }
        : { kind: 'unconfigured' }
    case 'CUSTOM_NWC':
      return input.nwcConnection
        ? { kind: 'nwc', connectionString: input.nwcConnection.connectionString }
        : { kind: 'unconfigured' }
    case 'DEFAULT_NWC': {
      const uri =
        input.primaryNwcConnection?.connectionString ?? input.userNwc ?? null
      return uri ? { kind: 'nwc', connectionString: uri } : { kind: 'unconfigured' }
    }
  }
}

/**
 * Parse `user@host` out of a LUD-16 / internet-identifier string. Returns
 * `null` for anything that isn't a well-formed address — callers surface a
 * 404 in that case rather than making a dubious outbound request.
 */
export function parseLightningAddress(
  raw: string,
): { user: string; host: string } | null {
  const at = raw.indexOf('@')
  if (at <= 0 || at === raw.length - 1) return null
  const user = raw.slice(0, at).trim().toLowerCase()
  const host = raw.slice(at + 1).trim().toLowerCase()
  // Basic guardrails: host must look like a hostname, user must only contain
  // the characters LUD-16 permits (§ "LNURL-pay address encoding").
  if (!/^[a-z0-9._%+-]+$/.test(user)) return null
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null
  return { user, host }
}
