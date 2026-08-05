import { parseLightningAddress } from '@/lib/wallet/resolve-payment-route'
import { resolveApiUrl } from '@/lib/public-url'
import { localBlockedHosts } from './local-hosts'

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
  return { username: parsed.user, origin: new URL(await resolveApiUrl()).origin }
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
