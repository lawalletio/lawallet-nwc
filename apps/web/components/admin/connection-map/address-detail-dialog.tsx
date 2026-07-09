'use client'

import React from 'react'
import Link from 'next/link'
import { AtSign, ExternalLink, Star } from 'lucide-react'
import {
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/client/format'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import { SuccessHeroCard } from '@/components/wallet/new-address-dialog'
import { InfoField } from './info-field'
import { WalletLiveBalance } from './wallet-live-balance'

interface Props {
  address: WalletAddress
  domain: string
  wallets: RemoteWalletData[]
  primaryWallet: RemoteWalletData | null
  /**
   * Optional — when provided, the "Bound wallet" line becomes a button
   * that swaps the LA body out for the wallet body inside the shared
   * parent dialog. The Connection Map passes a handler that just flips
   * `selected` to `{ kind: 'wallet', id }`, which re-renders the body
   * inside the SAME open `<Dialog>` — the backdrop stays mounted, no
   * cross-fade flicker.
   */
  onOpenWallet?: (walletId: string) => void
}

/**
 * Lightning Address detail body. Rendered as a child of the single
 * shared `<Dialog>` in `connection-map.tsx`; this component does NOT
 * mount its own Dialog or DialogContent — the parent provides both so
 * the backdrop / portal stay continuous when the user navigates from
 * one entity dialog to another (e.g. via the bound-wallet link). Read-
 * only summary — the "Edit" button jumps to the existing per-address
 * page (`/admin/addresses/[username]`) for actual changes, so this
 * body stays a glance-able card rather than a second editor.
 *
 * The bound-wallet name is resolved from the wallets list the parent
 * already has in memory, so we don't fire an extra fetch just to show
 * one label.
 */
export function AddressDetailBody({
  address,
  domain,
  wallets,
  primaryWallet,
  onOpenWallet,
}: Props) {
  // For CUSTOM_NWC the wallet is the explicitly-bound one. For DEFAULT_NWC
  // the implicit binding is the wallet linked to the account's primary
  // Lightning Address.
  const boundWallet =
    address.mode === 'CUSTOM_NWC' && address.remoteWalletId
      ? wallets.find(w => w.id === address.remoteWalletId)
      : address.mode === 'DEFAULT_NWC'
        ? primaryWallet
        : null

  return (
    // Body-only — the parent owns the Dialog + DialogContent + Overlay,
    // so swapping between bodies inside that single Dialog keeps the
    // backdrop mounted (no fade-out → fade-in flicker). Returns a
    // Fragment so DialogHeader / content / DialogFooter become direct
    // children of the parent's `grid gap-4` wrapper.
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AtSign className="size-4 text-emerald-400" />
          Lightning Address
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
          {/* Hero — reuses the success-card-style lightning bolt visual
              from new-address-dialog.tsx so the LA gets a proper
              "this is your lightning address" presentation instead of a
              bare label. The Primary badge moves below since the hero
              already carries the address inside its pill. */}
          <SuccessHeroCard address={`${address.username}@${domain}`} />
          {address.isPrimary && (
            <div>
              <Badge variant="secondary" className="gap-1">
                <Star className="size-3 fill-amber-400 text-amber-400" />
                Primary
              </Badge>
            </div>
          )}

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
                  onOpenWallet ? (
                    // Clickable — clicking swaps this dialog out for the
                    // wallet dialog. Plain <button> so we don't pick up
                    // shadcn Button's padding / variant styling (this
                    // sits inside an InfoField, the row sizing comes
                    // from there).
                    <button
                      type="button"
                      onClick={() => onOpenWallet(boundWallet.id)}
                      className="flex items-center gap-1 text-left hover:underline"
                    >
                      {boundWallet.name}
                      {boundWallet.isDefault && (
                        <Star
                          className="size-3 fill-amber-400 text-amber-400"
                          aria-label="Primary"
                        />
                      )}
                    </button>
                  ) : (
                    <span className="flex items-center gap-1">
                      {boundWallet.name}
                      {boundWallet.isDefault && (
                        <Star
                          className="size-3 fill-amber-400 text-amber-400"
                          aria-label="Primary"
                        />
                      )}
                    </span>
                  )
                }
              />
            )}

            {/* Live balance — same component + visual treatment as the
                wallet detail dialog so the two views agree on the
                number. Skip entirely when there's no wallet behind the
                LA (IDLE / ALIAS): there's literally nothing to show.
                When the bound wallet is REVOKED we still render so the
                muted dot makes the "no balance available" state legible. */}
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
              value={formatRelativeTime(address.createdAt)}
            />
            <InfoField
              label="Updated"
              value={formatRelativeTime(address.updatedAt)}
            />
          </div>
        </div>

      <DialogFooter>
        <Button variant="secondary" asChild>
          <Link href={`/admin/addresses/${encodeURIComponent(address.username)}`}>
            Edit address
            <ExternalLink className="ml-1 size-3" />
          </Link>
        </Button>
      </DialogFooter>
    </>
  )
}
