'use client'

import React from 'react'
import Link from 'next/link'
import { CreditCard, ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
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

interface Props {
  card: CardData
  wallets: RemoteWalletData[]
  onClose: () => void
}

/**
 * Card detail dialog. Larger design preview at the top — the canvas
 * thumb is 196 px wide, here we render at full dialog width with the
 * same 8:5 aspect so the design is recognisable at a glance.
 *
 * "View card" jumps to the existing `/admin/cards/[id]` page for the
 * full administrative view (ntag424 keys, scan history, delete).
 */
export function CardDetailDialog({ card, wallets, onClose }: Props) {
  const boundWallet = card.remoteWalletId
    ? wallets.find(w => w.id === card.remoteWalletId)
    : null
  const title = card.title ?? card.lightningAddress?.username ?? truncateHex(card.id)

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
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

            {card.lightningAddress && (
              <InfoField
                label="Lightning Address"
                value={`${card.lightningAddress.username}`}
              />
            )}

            <InfoField
              label="Bound wallet"
              value={
                boundWallet ? (
                  boundWallet.name
                ) : (
                  <span className="text-muted-foreground">None (uses default)</span>
                )
              }
            />

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
          <Button variant="secondary" asChild onClick={onClose}>
            <Link href={`/admin/cards/${card.id}`}>
              View card
              <ExternalLink className="ml-1 size-3" />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
