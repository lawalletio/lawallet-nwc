import { getSettings } from '@/lib/settings'
import {
  buildPublicHost,
  buildPublicUrl,
  parseEndpoint
} from '@/lib/public-url-utils'

export interface PublicEndpoint {
  /**
   * The full hostname this instance is published under (e.g. `app.example.com`).
   * NOT the lightning-address domain — use {@link resolveAddressDomain} for that.
   */
  host: string
  /** The full URL used for LNURL callbacks (e.g. `https://app.example.com`). */
  url: string
}

/**
 * Resolves the platform's public-facing host and URL.
 *
 * Settings:
 * - `endpoint` — full URL where this instance runs (e.g. `https://app.example.com`).
 *   Bare hosts are accepted; missing protocol falls back to `https://`.
 * - `domain` — the root domain used for the lightning address (e.g. `example.com`).
 *
 * Priority:
 * 1. `endpoint` (parsed as URL — protocol respected, https default).
 * 2. `domain` (https default).
 * 3. Request `host` header (fallback for local/dev).
 */
export async function resolvePublicEndpoint(request?: {
  headers: { get: (k: string) => string | null }
}): Promise<PublicEndpoint> {
  const settings = await getSettings(['domain', 'endpoint'], {
    cache: 'hot'
  })

  const parsed = parseEndpoint(settings.endpoint)
  if (parsed) {
    return {
      host: parsed.host,
      url: `${parsed.protocol}//${parsed.host}`
    }
  }

  const domainHost = buildPublicHost(settings.domain)
  if (domainHost) {
    return { host: domainHost, url: buildPublicUrl(domainHost) }
  }

  const headerHost = request?.headers.get('host') || 'localhost:3000'
  return { host: headerHost, url: buildPublicUrl(headerHost) }
}

/**
 * Resolves the hostname that labels lightning addresses (`username@<host>`).
 *
 * The mirror of {@link resolveApiUrl}: that one is where the instance is
 * *reachable*, this one is what the address is *called*. They differ whenever
 * the API lives on its own host — `endpoint=https://beta.lacrypta.ar` while
 * `domain=lacrypta.ar` — so LUD-16 metadata must never label an address with
 * the endpoint host.
 *
 * Priority:
 * 1. `domain`.
 * 2. `endpoint` host (instances that never configured a separate domain).
 * 3. Request `host` header, then the request URL's host (fallback for local/dev).
 */
export async function resolveAddressDomain(request?: {
  headers: { get: (k: string) => string | null }
  url?: string
}): Promise<string> {
  const settings = await getSettings(['domain', 'endpoint'], {
    cache: 'hot'
  })

  const host = buildPublicHost(settings.domain)
  if (host) return host

  return (
    parseEndpoint(settings.endpoint)?.host ||
    request?.headers.get('host') ||
    (request?.url && new URL(request.url).host) ||
    'localhost:3000'
  )
}

/**
 * Resolves the API URL of *this instance* — the address where the server is
 * actually reachable and clients should send requests.
 *
 * Unlike {@link resolvePublicEndpoint}, this deliberately does **not** fall back
 * to the lightning-address `domain` setting. An instance served at
 * `http://localhost:55067` may advertise a public address domain of
 * `lacrypta.ar` for LUD-16, but a device token must be bound to the former — the
 * URL the device will actually call — not the latter.
 *
 * Priority:
 * 1. `endpoint` setting (parsed as URL — protocol respected, https default).
 * 2. Request `host` header (the URL the request came in on; `localhost:3000`
 *    when absent).
 */
export async function resolveApiUrl(request?: {
  headers: { get: (k: string) => string | null }
}): Promise<string> {
  const { endpoint } = await getSettings(['endpoint'], { cache: 'hot' })

  const parsed = parseEndpoint(endpoint)
  if (parsed) {
    return `${parsed.protocol}//${parsed.host}`
  }

  const headerHost = request?.headers.get('host') || 'localhost:3000'
  return buildPublicUrl(headerHost)
}
