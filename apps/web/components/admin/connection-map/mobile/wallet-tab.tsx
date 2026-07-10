'use client'

import React from 'react'
import { AtSign, CreditCard, Plus, Star, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { truncateHex } from '@/lib/client/format'
import { useSettings } from '@/lib/client/hooks/use-settings'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'
import type { CardData } from '@/lib/client/hooks/use-cards'
import {
  useRemoteWalletMutations,
  type RemoteWalletData,
} from '@/lib/client/hooks/use-remote-wallets'
import { WalletLiveBalance } from '../wallet-live-balance'
import { routesThroughPrimaryWallet } from '../primary-wallet'

interface Props {
  wallets: RemoteWalletData[]
  addresses: WalletAddress[]
  cards: CardData[]
  onOpenDetail: (walletId: string) => void
}

/**
 * Wallets tab (mobile) — read-only. Each wallet card shows its identity
 * + live balance, then everything bound to it: Lightning Addresses
 * (CUSTOM_NWC pointing here, or DEFAULT_NWC when this wallet is linked to
 * the primary address)
 * and Cards (explicit `remoteWalletId`). Rebinds happen from the
 * Addresses / Cards tabs, not here — tapping a wallet opens its detail
 * dialog (Send / Receive / manage).
 */
export function WalletTab({ wallets, addresses, cards, onOpenDetail }: Props) {
  if (wallets.length === 0) {
    return <EmptyWalletsState />
  }

  return (
    <ul className="flex flex-col gap-3">
      {wallets.map(w => {
        // Same binding logic as WalletDetailBody / buildGraph.
        const boundLas = addresses.filter(a => {
          return routesThroughPrimaryWallet(a, w.id, addresses)
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
                      aria-label="Primary"
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
                          primary
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

/**
 * Empty state for the Wallets tab. When the operator has enabled LNCurl, it
 * doubles as a one-tap CTA to mint a free disposable wallet — mirroring the
 * desktop ghost wallet node.
 */
function EmptyWalletsState() {
  const { data: settings } = useSettings()
  const lncurlEnabled = settings?.lncurl_enabled === 'true'
  const { createLncurlWallet, loading } = useRemoteWalletMutations()

  async function handleCreate() {
    try {
      await createLncurlWallet()
      toast.success('LNCurl wallet created')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create LNCurl wallet')
    }
  }

  if (!lncurlEnabled) {
    return (
      <p className="px-1 py-8 text-center text-sm text-muted-foreground">
        No remote wallets yet.
      </p>
    )
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-4 py-8 text-center">
      <Wallet className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        No wallet yet. Spin up a free disposable LNCurl wallet to start
        receiving.
      </p>
      <Button className="gap-2" onClick={handleCreate} disabled={loading}>
        {loading ? <Spinner className="size-4" /> : <Plus className="size-4" />}
        Create LNCurl wallet
      </Button>
    </div>
  )
}
