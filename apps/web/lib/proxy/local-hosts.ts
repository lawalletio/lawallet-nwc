import {
  resolveApiUrl,
  resolvePublicEndpoint,
  resolveAddressDomain
} from '@/lib/public-url'

/**
 * The subset of {@link localBlockedHosts} inputs that the request-aware
 * overloads in `public-url.ts` accept. `NextRequest` satisfies this, and
 * request-less callers (the forwarding reconciler, config-time cycle
 * detection) pass `undefined` to keep the historical, settings-only behaviour.
 */
export interface LocalHostRequest {
  headers: { get: (k: string) => string | null }
  url?: string
}

/**
 * Hostnames that resolve back to this instance. A forwarding destination on
 * one of these would loop payments through ourselves, so both the config-time
 * check and the dispatch-time LNURL fetch refuse them. Includes the
 * lightning-address domain alongside the endpoint/API hosts, since a
 * destination can be written as `user@<domain>` even when the domain doesn't
 * serve the API.
 *
 * Threading the inbound request is what keeps an ALIAS self-cycle from
 * amplifying requests: an instance is often reachable through more than one
 * public hostname (a custom `endpoint`/`domain` plus a platform default host
 * such as `<app>.onrender.com`), and the configured hosts alone do not cover
 * every name that routes here. The hostname the request actually arrived on
 * is therefore folded in (Host header, then the request URL's host), so the
 * cycle detector recognises this instance no matter which DNS name the
 * request came in on. Request-less callers see only the configured hosts, as
 * before.
 */
export async function localBlockedHosts(
  req?: LocalHostRequest
): Promise<string[]> {
  const [publicEndpoint, apiUrl, addressDomain] = await Promise.all([
    resolvePublicEndpoint(req),
    resolveApiUrl(req),
    resolveAddressDomain(req)
  ])
  const hosts = [publicEndpoint.host, addressDomain, new URL(apiUrl).hostname]
  const arrival = arrivalHost(req)
  if (arrival) hosts.push(arrival)
  return hosts
}

/**
 * The hostname this request arrived on. The `Host` header is the primary
 * signal; the request URL's host covers proxies that don't surface it. Returns
 * `null` when there is no request, so background callers keep behaving exactly
 * as they did with the request-less overload.
 */
function arrivalHost(req?: LocalHostRequest): string | null {
  if (!req) return null
  const headerHost = req.headers.get('host')
  if (headerHost) return headerHost
  if (req.url) {
    try {
      return new URL(req.url).host
    } catch {
      return null
    }
  }
  return null
}
