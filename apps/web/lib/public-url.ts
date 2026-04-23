import { getSettings } from '@/lib/settings'
import { buildPublicHost, buildPublicUrl } from '@/lib/public-url-utils'

export interface PublicEndpoint {
  /** The full hostname used in lightning addresses (e.g. `app.example.com` or `example.com`). */
  host: string
  /** The full HTTPS URL used for LNURL callbacks (e.g. `https://app.example.com`). */
  url: string
}

/**
 * Resolves the platform's public-facing host and URL.
 *
 * Settings:
 * - `domain` — the root domain (e.g. `example.com`)
 * - `endpoint` — optional subdomain prefix (e.g. `app`). Older installs may
 *   still use the legacy `subdomain` key.
 *
 * Priority:
 * 1. Settings `endpoint` + `domain` → `endpoint.domain`
 * 2. Settings `domain` only → `domain`
 * 3. Request `host` header (fallback for local/dev)
 *
 * Always uses https:// unless the host is localhost.
 */
export async function resolvePublicEndpoint(
  request?: { headers: { get: (k: string) => string | null } }
): Promise<PublicEndpoint> {
  const settings = await getSettings(['domain', 'endpoint', 'subdomain'])
  const configuredSubdomain = settings.endpoint || settings.subdomain
  const host =
    buildPublicHost(settings.domain, configuredSubdomain) ||
    request?.headers.get('host') ||
    'localhost:3000'
  const url = buildPublicUrl(host)

  return { host, url }
}
