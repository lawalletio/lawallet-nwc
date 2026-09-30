/**
 * Resolve the NWC connection the in-app wallet UI should use for the signed-in
 * user — their primary spendable wallet.
 *
 * `/api/users/me` returns two related fields:
 *   - `effectiveNwcString` — the wallet the user's **primary address** routes
 *     to (CUSTOM_NWC binding / DEFAULT_NWC primary-address wallet), or `null` when the
 *     address isn't routable (IDLE / ALIAS / unconfigured / no address yet).
 *   - `nwcString` — the user's derived **primary RemoteWallet** connection,
 *     or `''` when none.
 *
 * The wallet app shows the user's own wallet, so prefer the address-routed
 * wallet but fall back to the derived primary wallet string. Without the
 * fallback the home screen renders "No wallet connected" even though the user
 * has a live RemoteWallet that is not currently routable.
 *
 * Empty strings collapse to `null` (via `||`) so callers can treat the result
 * as a simple "connected?" signal.
 */
export function resolveUserNwc(
  me:
    | { effectiveNwcString?: string | null; nwcString?: string | null }
    | null
    | undefined
): string | null {
  return me?.effectiveNwcString || me?.nwcString || null
}

type UserNwcFields = {
  effectiveNwcString?: string | null
  nwcString?: string | null
}

/**
 * Re-read `/api/users/me` immediately before a send or receive. That request
 * replaces a DEAD courtesy LNCurl wallet, so the NWC URI used for
 * `pay_invoice` / `make_invoice` is the replacement. A missing response
 * (tests, or a transport glitch before any body) keeps the cached URI.
 */
export async function resolveFreshUserNwc(
  load: () => Promise<UserNwcFields | null | undefined>,
  cached: string | null
): Promise<string | null> {
  const fresh = await load()
  if (!fresh) return cached
  return resolveUserNwc(fresh)
}
