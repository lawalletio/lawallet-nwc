'use client'

import React, { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Spinner } from '@/components/ui/spinner'
import { useRemoteWallets } from '@/lib/client/hooks/use-remote-wallets'
import { useMyAddresses } from '@/lib/client/hooks/use-wallet-addresses'
import { useCards } from '@/lib/client/hooks/use-cards'
import { useSettings } from '@/lib/client/hooks/use-settings'
import { useAuth } from '@/components/admin/auth-context'
import { Permission } from '@/lib/auth/permissions'
import {
  ConnectionDetailDialog,
  type ConnectionSelection,
} from '../connection-detail-dialog'
import { AddressTab } from './address-tab'
import { CardTab } from './card-tab'
import { WalletTab } from './wallet-tab'

/**
 * Mobile / tablet (<1024 px) Connection Map — three tabs (Addresses ·
 * Cards · Wallets) instead of the desktop xyflow canvas (#235). Same
 * data hooks; rebinds happen via tap-chip bottom-sheet pickers in the
 * Addresses / Cards tabs. Tapping a row opens the SAME shared
 * `ConnectionDetailDialog` the desktop canvas uses, so detail / send /
 * receive behaviour is identical across layouts.
 */
export function ConnectionMapMobile() {
  const { isAuthorized } = useAuth()
  const { data: settings } = useSettings()
  const { data: wallets, loading: walletsLoading } = useRemoteWallets()
  const { data: addresses, loading: addressesLoading } = useMyAddresses()
  // `/api/cards` is admin-scoped — skip the fetch (and the guaranteed
  // 403) for callers without the permission. Mirrors the desktop map.
  const canReadCards = isAuthorized(Permission.CARDS_READ)
  const { data: cards, loading: cardsLoading } = useCards(undefined, {
    enabled: canReadCards,
  })

  const domain = settings?.domain || 'your-domain'
  const loading = walletsLoading || addressesLoading || cardsLoading

  // Row tap → shared detail dialog (Address / Wallet / Card bodies).
  const [selected, setSelected] = useState<ConnectionSelection>(null)

  const addressList = addresses ?? []
  const walletList = wallets ?? []
  const cardList = cards ?? []

  if (loading && !walletList.length && !addressList.length && !cardList.length) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={24} className="text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Tabs defaultValue="addresses" className="flex min-h-0 flex-1 flex-col">
        <div className="px-4 pt-3">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="addresses">
              Addresses
              {addressList.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {addressList.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="cards">
              Cards
              {cardList.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {cardList.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="wallets">
              Wallets
              {walletList.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {walletList.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Each panel scrolls independently below the fixed tab bar. The
            bottom padding clears the mobile tab bar + safe area. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(5rem,calc(env(safe-area-inset-bottom)+5rem))] pt-3">
          <TabsContent value="addresses" className="mt-0">
            <AddressTab
              addresses={addressList}
              wallets={walletList}
              onOpenDetail={username => setSelected({ kind: 'la', username })}
            />
          </TabsContent>
          <TabsContent value="cards" className="mt-0">
            <CardTab
              cards={cardList}
              wallets={walletList}
              canRead={canReadCards}
              onOpenDetail={id => setSelected({ kind: 'card', id })}
            />
          </TabsContent>
          <TabsContent value="wallets" className="mt-0">
            <WalletTab
              wallets={walletList}
              addresses={addressList}
              cards={cardList}
              onOpenDetail={id => setSelected({ kind: 'wallet', id })}
            />
          </TabsContent>
        </div>
      </Tabs>

      <ConnectionDetailDialog
        selected={selected}
        onSelect={setSelected}
        addresses={addresses}
        cards={cards}
        wallets={wallets}
        domain={domain}
      />
    </div>
  )
}
