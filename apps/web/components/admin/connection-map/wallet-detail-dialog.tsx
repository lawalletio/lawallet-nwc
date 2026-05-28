'use client'

import React from 'react'
import Link from 'next/link'
import { ExternalLink, Star, Wallet } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/client/format'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'
import type { CardData } from '@/lib/client/hooks/use-cards'
import { InfoField } from './info-field'
import { WalletLiveBalance } from './wallet-live-balance'

interface Props {
  wallet: RemoteWalletData
  /** Caller's full LA list — used to count how many bind to this wallet. */
  addresses: WalletAddress[]
  /** Caller's full card list — used to count how many bind to this wallet. */
  cards: CardData[]
  onClose: () => void
}

/**
 * Remote Wallet detail dialog. Mirrors the node's live balance line
 * (status dot + odometer-animated sats) and adds counts of bound LAs /
 * cards so the dialog tells a richer story than the chip on the canvas.
 *
 * There's no per-wallet detail PAGE today (only the list); the "Manage"
 * button jumps to the list page where the row dropdown handles renames /
 * status flips / etc.
 */
export function WalletDetailDialog({ wallet, addresses, cards, onClose }: Props) {
  const isLive = wallet.status !== 'REVOKED'

  // Match the LA edge logic in buildGraph: a wallet is "bound" to an
  // address either explicitly (CUSTOM_NWC + matching remoteWalletId) or
  // implicitly (DEFAULT_NWC routing through whatever wallet is default).
  const boundLas = addresses.filter(a => {
    if (a.mode === 'CUSTOM_NWC') return a.remoteWalletId === wallet.id
    if (a.mode === 'DEFAULT_NWC') return wallet.isDefault
    return false
  })
  const boundCards = cards.filter(c => c.remoteWalletId === wallet.id)

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="size-4 text-amber-400" />
            Remote Wallet
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Hero — wallet name + Default star. */}
          <div className="flex items-center gap-2 text-base font-medium">
            <span className="truncate">{wallet.name}</span>
            {wallet.isDefault && (
              <Badge variant="secondary" className="gap-1">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                Default
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Type" value={<Badge variant="outline">{wallet.type}</Badge>} />
            <InfoField
              label="Status"
              value={<Badge variant="outline">{wallet.status}</Badge>}
            />

            <div className="col-span-2">
              <InfoField
                label="Balance"
                value={<WalletLiveBalance walletId={isLive ? wallet.id : null} />}
              />
            </div>

            <InfoField
              label="Bound addresses"
              value={
                boundLas.length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  <span>{boundLas.length}</span>
                )
              }
            />
            <InfoField
              label="Bound cards"
              value={
                boundCards.length === 0 ? (
                  <span className="text-muted-foreground">None</span>
                ) : (
                  <span>{boundCards.length}</span>
                )
              }
            />

            <InfoField
              label="Created"
              value={formatRelativeTime(wallet.createdAt)}
            />
            <InfoField
              label="Updated"
              value={formatRelativeTime(wallet.updatedAt)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" asChild onClick={onClose}>
            <Link href="/admin/remote-wallets">
              Manage wallet
              <ExternalLink className="ml-1 size-3" />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
