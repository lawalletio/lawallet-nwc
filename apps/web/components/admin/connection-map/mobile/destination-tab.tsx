'use client'

import { MapPin, Waypoints } from 'lucide-react'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import type { ProxyDestinationRoute } from '../proxy-destinations'

export function DestinationTab({
  destinations,
  wallets,
  domain
}: {
  destinations: ProxyDestinationRoute[]
  wallets: RemoteWalletData[]
  domain: string
}) {
  const walletNames = new Map(wallets.map(wallet => [wallet.id, wallet.name]))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Waypoints className="size-4 text-orange-400" aria-hidden />
        Active destinations used by address and wallet proxies.
      </div>
      {destinations.map(destination => (
        <div
          key={destination.address}
          className="rounded-xl border border-orange-500/25 bg-orange-500/[0.04] p-4"
        >
          <div className="flex items-center gap-2">
            <MapPin className="size-4 shrink-0 text-orange-400" aria-hidden />
            <span className="min-w-0 truncate font-mono text-sm font-medium">
              {destination.address}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {destination.lightningAddressUsernames.map(username => (
              <span
                key={`address:${username}`}
                className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"
              >
                {username}@{domain}
              </span>
            ))}
            {destination.walletIds.map(walletId => (
              <span
                key={`wallet:${walletId}`}
                className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"
              >
                {walletNames.get(walletId) ?? 'Remote wallet'}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
