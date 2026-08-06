import type { RemoteWalletForwardingMapAction } from '@/lib/client/hooks/use-remote-wallet-forwarding'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'

export interface ProxyDestinationRoute {
  address: string
  lightningAddressUsernames: string[]
  walletIds: string[]
}

/**
 * Build a deduplicated destination index in one pass. One destination node may
 * be shared by multiple proxy addresses and RemoteWallet forwarding plans.
 */
export function indexProxyDestinations(
  addresses: WalletAddress[] | null,
  actions: RemoteWalletForwardingMapAction[] | null
): ProxyDestinationRoute[] {
  const byAddress = new Map<string, ProxyDestinationRoute>()

  const routeFor = (rawAddress: string) => {
    const address = rawAddress.trim().toLowerCase()
    let route = byAddress.get(address)
    if (!route) {
      route = {
        address,
        lightningAddressUsernames: [],
        walletIds: []
      }
      byAddress.set(address, route)
    }
    return route
  }

  for (const lightningAddress of addresses ?? []) {
    if (lightningAddress.mode !== 'PROXY_ALIAS' || !lightningAddress.redirect)
      continue
    routeFor(lightningAddress.redirect).lightningAddressUsernames.push(
      lightningAddress.username
    )
  }

  for (const action of actions ?? []) {
    for (const destination of action.destinations) {
      const route = routeFor(destination.address)
      if (!route.walletIds.includes(action.walletId)) {
        route.walletIds.push(action.walletId)
      }
    }
  }

  return [...byAddress.values()].sort((a, b) =>
    a.address.localeCompare(b.address)
  )
}
