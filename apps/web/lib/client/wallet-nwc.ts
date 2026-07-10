/**
 * Resolve the NWC connection the in-app wallet UI should use for the signed-in
 * user — their primary spendable wallet.
 *
 * `/api/users/me` returns two related fields:
 *   - `effectiveNwcString` — the wallet the user's **primary address** routes
 *     to (CUSTOM_NWC binding / DEFAULT_NWC default wallet), or `null` when the
 *     address isn't routable (IDLE / ALIAS / unconfigured / no address yet).
 *   - `nwcString` — the user's **default RemoteWallet** connection (the same
 *     wallet the admin dashboard treats as "connected"), or `''` when none.
 *
 * `/wallet` is the user's primary lightning address plus their primary remote
 * wallet. A primary address may route through a custom wallet for receive
 * policy, but send/balance/activity should still use the primary RemoteWallet.
 *
 * Empty strings collapse to `null` (via `||`) so callers can treat the result
 * as a simple "connected?" signal.
 */
export function resolveUserNwc(
  me:
    | { effectiveNwcString?: string | null; nwcString?: string | null }
    | null
    | undefined,
): string | null {
  return me?.nwcString || me?.effectiveNwcString || null
}
