import { resolveApiUrl, resolvePublicEndpoint } from '@/lib/public-url'

/**
 * Hostnames that resolve back to this instance. A forwarding destination on
 * one of these would loop payments through ourselves, so both the config-time
 * check and the dispatch-time LNURL fetch refuse them.
 */
export async function localBlockedHosts(): Promise<string[]> {
  const [publicEndpoint, apiUrl] = await Promise.all([
    resolvePublicEndpoint(),
    resolveApiUrl()
  ])
  return [publicEndpoint.host, new URL(apiUrl).hostname]
}
