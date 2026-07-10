import type {
  LightningAddressMode,
  RemoteWalletStatus,
  RemoteWalletType,
} from '@/lib/generated/prisma'

// ── RemoteWallet routing ─────────────────────────────────────────────────────
//
// RemoteWallet is the single source of truth for wallets. These resolvers map
// a Lightning address or Card to a *driver-addressable wallet* — a
// `{ type, config }` pair the caller hands to the driver registry
// (`driverForWallet`) — so routing works across any wallet type, not just NWC.

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
 *   - `idle`          address is disabled (`mode=IDLE`).
 *   - `alias`         forward LUD-16 to another LN address (`mode=ALIAS`).
 *   - `wallet`        resolve through the driver registry.
 *   - `unconfigured`  no usable wallet/redirect — a 404 at the HTTP layer.
 */
export type WalletRoute =
  | { kind: 'idle' }
  | { kind: 'alias'; redirect: string }
  | { kind: 'wallet'; type: RemoteWalletType; config: unknown }
  | { kind: 'unconfigured' }

export interface ResolveWalletRouteInput {
  mode: LightningAddressMode
  redirect: string | null
  /** RemoteWallet bound directly to the address (CUSTOM_NWC). */
  remoteWallet: RemoteWalletRef | null
  /** The wallet linked through the user's primary Lightning Address. */
  defaultRemoteWallet: RemoteWalletRef | null
}

function walletRoute(wallet: RemoteWalletRef): WalletRoute {
  return wallet.status === 'ACTIVE'
    ? { kind: 'wallet', type: wallet.type, config: wallet.config }
    : { kind: 'unconfigured' }
}

/**
 * Resolve a Lightning address to a driver-addressable wallet.
 *
 * Priority, by mode:
 *   - `IDLE`        → idle.
 *   - `ALIAS`       → alias (or unconfigured if no redirect).
 *   - `CUSTOM_NWC`  → the address's bound `remoteWallet` when ACTIVE; a
 *                     non-ACTIVE (or absent) binding is `unconfigured` — an
 *                     explicit binding must never silently reroute.
 *   - `DEFAULT_NWC` → the primary-address `remoteWallet` when ACTIVE, else
 *                     unconfigured.
 *
 * The GET (metadata) and GET /cb (callback) LUD-16 routes both call this so
 * they stay in lockstep.
 */
export function resolveWalletRoute(input: ResolveWalletRouteInput): WalletRoute {
  switch (input.mode) {
    case 'IDLE':
      return { kind: 'idle' }
    case 'ALIAS':
      return input.redirect && input.redirect.trim().length > 0
        ? { kind: 'alias', redirect: input.redirect.trim() }
        : { kind: 'unconfigured' }
    case 'CUSTOM_NWC':
      return input.remoteWallet ? walletRoute(input.remoteWallet) : { kind: 'unconfigured' }
    case 'DEFAULT_NWC':
      return input.defaultRemoteWallet
        ? walletRoute(input.defaultRemoteWallet)
        : { kind: 'unconfigured' }
  }
}

/** Driver-addressable routing decision for a Card spend. */
export type CardWalletRoute =
  | { kind: 'wallet'; type: RemoteWalletType; config: unknown }
  | { kind: 'unconfigured' }

export interface ResolveCardWalletInput {
  /** RemoteWallet bound directly to the card. */
  remoteWallet: RemoteWalletRef | null
  /** The owner's primary-address RemoteWallet (when the card has no explicit binding). */
  defaultRemoteWallet: RemoteWalletRef | null
}

/**
 * Resolve which wallet a Card spends from when tapped.
 *
 * Priority:
 *   1. The card's bound `remoteWallet` when ACTIVE. A non-ACTIVE explicit
 *      binding returns `unconfigured` — a card tap is a real-time spend, so
 *      we must never silently route it to a *different* wallet than the one
 *      the holder bound.
 *   2. Otherwise (no explicit binding) the owner's primary-address RemoteWallet
 *      when ACTIVE.
 *
 * Symmetric with `resolveWalletRoute`'s CUSTOM/DEFAULT handling so card and
 * address routing share the same safety rules.
 */
export function resolveCardWallet(input: ResolveCardWalletInput): CardWalletRoute {
  if (input.remoteWallet) {
    return walletRoute(input.remoteWallet) as CardWalletRoute
  }
  if (input.defaultRemoteWallet?.status === 'ACTIVE') {
    return {
      kind: 'wallet',
      type: input.defaultRemoteWallet.type,
      config: input.defaultRemoteWallet.config,
    }
  }
  return { kind: 'unconfigured' }
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
