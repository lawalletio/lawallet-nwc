'use client'

import React from 'react'
import Link from 'next/link'
import { AtSign, ExternalLink, Star } from 'lucide-react'
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
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import { InfoField } from './info-field'

interface Props {
  address: WalletAddress
  domain: string
  wallets: RemoteWalletData[]
  onClose: () => void
}

/**
 * Lightning Address detail dialog. Click on an LA node in the canvas to
 * open it. Read-only summary — the "Edit" button jumps to the existing
 * per-address page (`/admin/addresses/[username]`) for actual changes,
 * so this dialog stays a glance-able card rather than a second editor.
 *
 * The bound-wallet name is resolved from the wallets list the parent
 * already has in memory, so we don't fire an extra fetch just to show
 * one label.
 */
export function AddressDetailDialog({ address, domain, wallets, onClose }: Props) {
  // For CUSTOM_NWC the wallet is the explicitly-bound one. For DEFAULT_NWC
  // the implicit binding is whatever the user's primary wallet is — the
  // PUT endpoint clears `remoteWalletId` for that mode, so we look up the
  // default wallet from the list instead of `address.remoteWalletId`.
  const boundWallet =
    address.mode === 'CUSTOM_NWC' && address.remoteWalletId
      ? wallets.find(w => w.id === address.remoteWalletId)
      : address.mode === 'DEFAULT_NWC'
        ? wallets.find(w => w.isDefault)
        : null

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AtSign className="size-4 text-emerald-400" />
            Lightning Address
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Hero — the address itself with a Primary badge inline. */}
          <div className="flex items-center gap-2 text-base font-medium">
            <span className="truncate">
              {address.username}
              <span className="text-muted-foreground">@{domain}</span>
            </span>
            {address.isPrimary && (
              <Badge variant="secondary" className="gap-1">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                Primary
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <InfoField label="Mode" value={<Badge variant="outline">{address.mode}</Badge>} />
            <InfoField
              label="Effective NWC"
              value={<Badge variant="outline">{address.nwcMode}</Badge>}
            />

            {address.mode === 'ALIAS' && address.redirect && (
              <InfoField
                label="Redirect"
                value={<span className="truncate">{address.redirect}</span>}
                mono
              />
            )}

            {boundWallet && (
              <InfoField
                label="Bound wallet"
                value={
                  <span className="flex items-center gap-1">
                    {boundWallet.name}
                    {boundWallet.isDefault && (
                      <Star
                        className="size-3 fill-amber-400 text-amber-400"
                        aria-label="Default"
                      />
                    )}
                  </span>
                }
              />
            )}

            <InfoField
              label="Created"
              value={formatRelativeTime(address.createdAt)}
            />
            <InfoField
              label="Updated"
              value={formatRelativeTime(address.updatedAt)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" asChild onClick={onClose}>
            <Link href={`/admin/addresses/${encodeURIComponent(address.username)}`}>
              Edit address
              <ExternalLink className="ml-1 size-3" />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
