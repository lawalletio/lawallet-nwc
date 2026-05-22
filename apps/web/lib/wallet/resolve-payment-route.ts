import type {
  LightningAddressMode,
  RemoteWalletStatus,
  RemoteWalletType,
} from '@/lib/generated/prisma'

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

// ── RemoteWallet-aware resolution (#234) ─────────────────────────────────────
//
// The successor to `resolvePaymentRoute`. Instead of emitting a raw NWC
// connection string, it resolves to a *driver-addressable wallet* — a
// `{ type, config }` pair the caller hands to the driver registry
// (`driverForWallet`). This is what lets receiving route through any wallet
// type, not just NWC.
//
// `resolvePaymentRoute` above stays for now as the legacy display path
// (the dashboard balance widget still wants a bare connection string); it
// gets removed once every call site is migrated and parity is verified.

/** A wallet reference resolved into a driver-addressable shape. */
export interface RemoteWalletRef {
  type: RemoteWalletType
  /** Driver-specific `RemoteWallet.config` JSON; validated by the driver. */
  config: unknown
  status: RemoteWalletStatus
}

/**
 * Driver-addressable routing decision for a Lightning address.
 *
 *   - `idle` / `alias` / `unconfigured`  — same semantics as `PaymentRoute`.
 *   - `wallet`  — resolve through the driver registry. `source` records
 *                 whether it came from a real `RemoteWallet` row or was
 *                 synthesised from a legacy NWC connection string, purely
 *                 for observability/metrics.
 */
export type WalletRoute =
  | { kind: 'idle' }
  | { kind: 'alias'; redirect: string }
  | {
      kind: 'wallet'
      type: RemoteWalletType
      config: unknown
      source: 'remote-wallet' | 'legacy-nwc'
    }
  | { kind: 'unconfigured' }

export interface ResolveWalletRouteInput {
  mode: LightningAddressMode
  redirect: string | null
  /** RemoteWallet bound directly to the address (CUSTOM_NWC successor). */
  remoteWallet: RemoteWalletRef | null
  /** The user's default RemoteWallet (DEFAULT_NWC successor). */
  defaultRemoteWallet: RemoteWalletRef | null
  /** Legacy NWCConnection bound to the address (CUSTOM_NWC fallback). */
  nwcConnection: { connectionString: string } | null
  /** Legacy user's primary NWCConnection (DEFAULT_NWC fallback). */
  primaryNwcConnection: { connectionString: string } | null
  /** Legacy `User.nwc` URI (last-resort DEFAULT_NWC fallback). */
  userNwc: string | null
}

/** Wrap a bare NWC connection string as a driver-addressable NWC wallet. */
function legacyNwcWallet(connectionString: string): WalletRoute {
  return {
    kind: 'wallet',
    type: 'NWC',
    // The NWC driver's config schema defaults `mode` to RECEIVE, which is
    // exactly what a receive route needs — but we set it explicitly so the
    // persisted shape and the synthesised one are identical.
    config: { connectionString, mode: 'RECEIVE' },
    source: 'legacy-nwc',
  }
}

/**
 * Resolve a Lightning address to a driver-addressable wallet.
 *
 * Priority, by mode:
 *   - `IDLE`        → idle.
 *   - `ALIAS`       → alias (or unconfigured if no redirect).
 *   - `CUSTOM_NWC`  → the address's bound `remoteWallet` when ACTIVE; a
 *                     non-ACTIVE bound wallet is treated as unconfigured
 *                     (an explicit binding to a dead wallet must NOT
 *                     silently reroute). If nothing's bound, fall back to
 *                     the legacy `nwcConnection`.
 *   - `DEFAULT_NWC` → the user's default `remoteWallet` when ACTIVE, else
 *                     legacy `primaryNwcConnection`, else legacy `userNwc`.
 *
 * Mirrors `resolvePaymentRoute`'s mode handling so the two can't drift
 * while both exist.
 */
export function resolveWalletRoute(input: ResolveWalletRouteInput): WalletRoute {
  switch (input.mode) {
    case 'IDLE':
      return { kind: 'idle' }
    case 'ALIAS':
      return input.redirect && input.redirect.trim().length > 0
        ? { kind: 'alias', redirect: input.redirect.trim() }
        : { kind: 'unconfigured' }
    case 'CUSTOM_NWC': {
      if (input.remoteWallet) {
        return input.remoteWallet.status === 'ACTIVE'
          ? {
              kind: 'wallet',
              type: input.remoteWallet.type,
              config: input.remoteWallet.config,
              source: 'remote-wallet',
            }
          : { kind: 'unconfigured' }
      }
      return input.nwcConnection
        ? legacyNwcWallet(input.nwcConnection.connectionString)
        : { kind: 'unconfigured' }
    }
    case 'DEFAULT_NWC': {
      if (input.defaultRemoteWallet) {
        if (input.defaultRemoteWallet.status === 'ACTIVE') {
          return {
            kind: 'wallet',
            type: input.defaultRemoteWallet.type,
            config: input.defaultRemoteWallet.config,
            source: 'remote-wallet',
          }
        }
        // A disabled/revoked default still has legacy fallbacks below — a
        // dead *default* shouldn't strand the user the way a dead *explicit*
        // binding does, since "default" is implicit routing.
      }
      const uri =
        input.primaryNwcConnection?.connectionString ?? input.userNwc ?? null
      return uri ? legacyNwcWallet(uri) : { kind: 'unconfigured' }
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
