import {
  resolveApiUrl,
  resolvePublicEndpoint,
  resolveAddressDomain
} from '@/lib/public-url'

/**
 * Hostnames that resolve back to this instance. A forwarding destination on
 * one of these would loop payments through ourselves, so both the config-time
 * check and the dispatch-time LNURL fetch refuse them. Includes the
 * lightning-address domain alongside the endpoint/API hosts, since a
 * destination can be written as `user@<domain>` even when the domain doesn't
 * serve the API.
 */
export async function localBlockedHosts(): Promise<string[]> {
  const [publicEndpoint, apiUrl, addressDomain] = await Promise.all([
    resolvePublicEndpoint(),
    resolveApiUrl(),
    resolveAddressDomain()
  ])
  return [publicEndpoint.host, addressDomain, new URL(apiUrl).hostname]
}
