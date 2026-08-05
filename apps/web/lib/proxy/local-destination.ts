import { parseLightningAddress } from '@/lib/wallet/resolve-payment-route'
import { resolvePublicEndpoint } from '@/lib/public-url'
import { getSettings } from '@/lib/settings'
import { localBlockedHosts } from './local-hosts'

/**
 * Origin to use when this instance calls its own LUD-16 endpoints.
 *
 * `resolveApiUrl()` is not usable here: with no `endpoint` setting it reads the
 * request's Host header, and falls back to `localhost:3000` when there is no
 * request at all — which is exactly the case in the forwarding reconciler, a
 * background job. That fallback points at nothing and fails the forward.
 */
export async function resolveSelfOrigin(): Promise<string> {
  const { endpoint } = await getSettings(['endpoint'], { cache: 'hot' })
  const configured = endpoint?.trim()
  if (configured) {
    return new URL(
      /^https?:\/\//i.test(configured) ? configured : `https://${configured}`
    ).origin
  }
  // Self-hosted and development: talk to the port this process listens on
  // rather than a public hostname that may not resolve back to this machine.
  const port = process.env.PORT?.trim()
  if (port) return `http://127.0.0.1:${port}`
  return new URL((await resolvePublicEndpoint()).url).origin
}

export interface LocalDestination {
  username: string
  /** Origin that serves this instance's own LUD-16 endpoints. */
  origin: string
}

/**
 * Recognises a forwarding destination that lives on this instance.
 *
 * Forwarding to ourselves is allowed, but it must not go out over the public
 * internet: the address' public host may not even be reachable from here (a
 * dev instance answers on `http://localhost:<port>`), and `safeHttpsGet`
 * deliberately refuses both plain HTTP and loopback. So a local destination is
 * resolved against `resolveApiUrl()` instead, which is the origin that
 * actually serves `/api/lud16/*` for this process.
 *
 * Loop safety does NOT depend on this function — it is enforced by the
 * forwarding hop counter (`lib/proxy/forward-hops.ts`) and by config-time
 * cycle detection, both of which work no matter how the hop is transported.
 */
export async function resolveLocalDestination(
  address: string
): Promise<LocalDestination | null> {
  const parsed = parseLightningAddress(address)
  if (!parsed) return null
  const blocked = await localBlockedHosts().catch(() => [])
  const host = parsed.host.toLowerCase()
  const isLocal = blocked.some(entry => normalizeHost(entry) === host)
  if (!isLocal) return null
  return { username: parsed.user, origin: await resolveSelfOrigin() }
}

/**
 * `localBlockedHosts()` mixes bare hostnames with `host:port` values, so both
 * sides are normalised through the URL parser before comparing.
 */
function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return ''
  try {
    return new URL(`https://${trimmed.replace(/^https?:\/\//, '')}`).hostname
  } catch {
    return trimmed
  }
}
