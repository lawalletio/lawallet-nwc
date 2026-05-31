'use client'

import React from 'react'
import Link from 'next/link'
import { CreditCard, ExternalLink } from 'lucide-react'
import {
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRelativeTime, truncateHex } from '@/lib/client/format'
import type { CardData } from '@/lib/client/hooks/use-cards'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import { InfoField } from './info-field'
import { WalletLiveBalance } from './wallet-live-balance'

interface Props {
  card: CardData
  wallets: RemoteWalletData[]
  /**
   * Optional — when provided, the "Bound wallet" line becomes a button
   * that swaps this body out for the wallet body inside the shared
   * parent dialog. Mirrors the LA body's pattern.
   */
  onOpenWallet?: (walletId: string) => void
  /**
   * Optional — when provided AND the card has a linked Lightning
   * Address, the "Lightning Address" line becomes a button that swaps
   * this body out for the LA body.
   */
  onOpenAddress?: (username: string) => void
}

/**
 * Card detail body. Rendered inside the single shared `<Dialog>` in
 * `connection-map.tsx` — no own Dialog / DialogContent wrapper. Larger
 * design preview at the top: the canvas thumb is 196 px wide; here we
 * render at full dialog width with the same 8:5 aspect so the design
 * is recognisable at a glance.
 *
 * Cross-dialog navigation: clicking the bound wallet swaps to the
 * wallet body, clicking the linked LA swaps to the LA body. Both just
 * flip the parent's `selected` state — the shared Dialog stays mounted
 * so the backdrop never flickers.
 *
 * "View card" (footer) jumps to the existing `/admin/cards/[id]` page
 * for the full administrative view (ntag424 keys, scan history, delete).
 */
export function CardDetailBody({
  card,
  wallets,
  onOpenWallet,
  onOpenAddress,
}: Props) {
  const boundWallet = card.remoteWalletId
    ? wallets.find(w => w.id === card.remoteWalletId)
    : null
  const title = card.title ?? card.lightningAddress?.username ?? truncateHex(card.id)

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CreditCard className="size-4 text-sky-400" />
          Card
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
          {/* Big design preview — falls through to a CreditCard-icon
              placeholder when the design has no uploaded image. */}
          {card.design?.image ? (
            <img
              src={card.design.image}
              alt={card.design.description ?? 'Card design'}
              className="aspect-[8/5] w-full rounded-md border border-border object-cover"
            />
          ) : (
            <div className="flex aspect-[8/5] w-full items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
              <CreditCard className="size-8" />
            </div>
          )}

          <div className="text-base font-medium">{title}</div>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <InfoField label="Card ID" value={card.id} mono />
            </div>

            {card.design?.description && (
              <InfoField label="Design" value={card.design.description} />
            )}

            <InfoField
              label="Pairing"
              value={
                <Badge variant={card.ntag424 ? 'default' : 'secondary'}>
                  {card.ntag424 ? 'Paired' : 'Unpaired'}
                </Badge>
              }
            />

            {/* Lightning Address — only when the card is claimed by a
                user. Clickable when the parent provides a handler so
                the user can hop straight into the LA detail dialog. */}
            {card.lightningAddress && (
              <InfoField
                label="Lightning Address"
                value={
                  onOpenAddress ? (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenAddress(card.lightningAddress!.username)
                      }
                      className="text-left hover:underline"
                    >
                      {card.lightningAddress.username}
                    </button>
                  ) : (
                    card.lightningAddress.username
                  )
                }
              />
            )}

            <InfoField
              label="Bound wallet"
              value={
                boundWallet ? (
                  onOpenWallet ? (
                    <button
                      type="button"
                      onClick={() => onOpenWallet(boundWallet.id)}
                      className="text-left hover:underline"
                    >
                      {boundWallet.name}
                    </button>
                  ) : (
                    boundWallet.name
                  )
                ) : (
                  <span className="text-muted-foreground">None (uses default)</span>
                )
              }
            />

            {/* Live balance — routed through the bound wallet, same
                visual treatment as the LA + wallet dialogs. Skip
                entirely when there's no wallet behind the card; the
                "Bound wallet: None" line above already conveys it. */}
            {boundWallet && (
              <div className="col-span-2">
                <InfoField
                  label="Balance"
                  value={
                    <WalletLiveBalance
                      walletId={boundWallet.status === 'REVOKED' ? null : boundWallet.id}
                    />
                  }
                />
              </div>
            )}

            <InfoField
              label="Created"
              value={formatRelativeTime(card.createdAt)}
            />
            <InfoField
              label="Updated"
              value={formatRelativeTime(card.updatedAt)}
            />
        </div>
      </div>

      <DialogFooter>
        <Button variant="secondary" asChild>
          <Link href={`/admin/cards/${card.id}`}>
            View card
            <ExternalLink className="ml-1 size-3" />
          </Link>
        </Button>
      </DialogFooter>
    </>
  )
}
