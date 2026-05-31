'use client'

import React from 'react'
import { AtSign, CreditCard, Star, Wallet } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { truncateHex } from '@/lib/client/format'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'
import type { CardData } from '@/lib/client/hooks/use-cards'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import { WalletLiveBalance } from '../wallet-live-balance'

interface Props {
  wallets: RemoteWalletData[]
  addresses: WalletAddress[]
  cards: CardData[]
  onOpenDetail: (walletId: string) => void
}

/**
 * Wallets tab (mobile) — read-only. Each wallet card shows its identity
 * + live balance, then everything bound to it: Lightning Addresses
 * (CUSTOM_NWC pointing here, or DEFAULT_NWC when this is the default)
 * and Cards (explicit `remoteWalletId`). Rebinds happen from the
 * Addresses / Cards tabs, not here — tapping a wallet opens its detail
 * dialog (Send / Receive / manage).
 */
export function WalletTab({ wallets, addresses, cards, onOpenDetail }: Props) {
  if (wallets.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-muted-foreground">
        No remote wallets yet.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-3">
      {wallets.map(w => {
        // Same binding logic as WalletDetailBody / buildGraph.
        const boundLas = addresses.filter(a => {
          if (a.mode === 'CUSTOM_NWC') return a.remoteWalletId === w.id
          if (a.mode === 'DEFAULT_NWC') return w.isDefault
          return false
        })
        const boundCards = cards.filter(c => c.remoteWalletId === w.id)
        const isLive = w.status !== 'REVOKED'

        return (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => onOpenDetail(w.id)}
              className="flex w-full flex-col gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/40"
            >
              {/* Identity + balance */}
              <div className="flex items-center gap-2">
                <Wallet className="size-4 shrink-0 text-amber-400" />
                <span className="flex min-w-0 flex-1 items-center gap-1 text-sm font-medium">
                  <span className="truncate">{w.name}</span>
                  {w.isDefault && (
                    <Star
                      className="size-3 shrink-0 fill-amber-400 text-amber-400"
                      aria-label="Default"
                    />
                  )}
                </span>
                <WalletLiveBalance
                  walletId={isLive ? w.id : null}
                  size="sm"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] font-normal">
                  {w.type}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-normal">
                  {w.status}
                </Badge>
              </div>

              {/* Bound entities */}
              {boundLas.length === 0 && boundCards.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing bound yet.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {boundLas.map(a => (
                    <span
                      key={`la:${a.username}`}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <AtSign className="size-3 shrink-0 text-emerald-400" />
                      <span className="truncate text-foreground">{a.username}</span>
                      {a.mode === 'DEFAULT_NWC' && (
                        <span className="text-[10px] uppercase tracking-wider">
                          default
                        </span>
                      )}
                    </span>
                  ))}
                  {boundCards.map(c => (
                    <span
                      key={`card:${c.id}`}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <CreditCard className="size-3 shrink-0 text-sky-400" />
                      <span className="truncate text-foreground">
                        {c.title ?? c.lightningAddress?.username ?? truncateHex(c.id)}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
