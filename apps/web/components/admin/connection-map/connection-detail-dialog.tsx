'use client'

import React from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import type { WalletAddress } from '@/lib/client/hooks/use-wallet-addresses'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import type { CardData } from '@/lib/client/hooks/use-cards'
import { AddressDetailBody } from './address-detail-dialog'
import { WalletDetailBody } from './wallet-detail-dialog'
import { CardDetailBody } from './card-detail-dialog'

/**
 * Which entity's detail body the shared dialog is showing. `null` =
 * closed. Keyed by raw model id (no node-id prefix) so the bodies look
 * the entity up in the local lists directly.
 */
export type ConnectionSelection =
  | { kind: 'la'; username: string }
  | { kind: 'wallet'; id: string }
  | { kind: 'card'; id: string }
  | null

interface Props {
  selected: ConnectionSelection
  /**
   * Change the selection. Used for close (`null`) AND cross-navigation
   * (clicking the bound-wallet line in the LA/Card body jumps to the
   * wallet body, etc.). The parent owns the state so both desktop
   * (canvas node clicks) and mobile (list row taps) can drive it.
   */
  onSelect: (sel: ConnectionSelection) => void
  addresses: WalletAddress[] | null
  cards: CardData[] | null
  wallets: RemoteWalletData[] | null
  domain: string
}

/**
 * Single shared detail dialog for the Connection Map (desktop canvas +
 * mobile tabs both use it). The parent `<Dialog>` / `<DialogContent>`
 * (and therefore the overlay + portal) stay mounted across navigation —
 * clicking "Bound wallet" inside the LA body just swaps the inner
 * Fragment instead of tearing down one dialog and rebuilding another,
 * so the backdrop never flickers.
 *
 * The `.find(…)` guards against the entity disappearing between the
 * open and the next SSE refresh (e.g. another tab revoked the wallet).
 * On a miss we render nothing inside the still-open Dialog;
 * `onOpenChange(false)` closes it on the next ESC / outside-click.
 *
 * `key={selected.kind}` retriggers `animate-in fade-in-0` on each kind
 * change for a soft cross-fade between bodies inside the shared frame.
 */
export function ConnectionDetailDialog({
  selected,
  onSelect,
  addresses,
  cards,
  wallets,
  domain,
}: Props) {
  const close = () => onSelect(null)
  const openWallet = (id: string) => onSelect({ kind: 'wallet', id })
  const openAddress = (username: string) => onSelect({ kind: 'la', username })

  return (
    <Dialog open={selected !== null} onOpenChange={o => !o && close()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <div
          key={selected?.kind ?? 'none'}
          className="grid gap-4 animate-in fade-in-0 duration-200"
        >
          {selected?.kind === 'la' &&
            (() => {
              const addr = addresses?.find(a => a.username === selected.username)
              return addr ? (
                <AddressDetailBody
                  address={addr}
                  domain={domain}
                  wallets={wallets ?? []}
                  onOpenWallet={openWallet}
                />
              ) : null
            })()}
          {selected?.kind === 'wallet' &&
            (() => {
              const w = wallets?.find(w => w.id === selected.id)
              return w ? (
                <WalletDetailBody
                  wallet={w}
                  addresses={addresses ?? []}
                  cards={cards ?? []}
                />
              ) : null
            })()}
          {selected?.kind === 'card' &&
            (() => {
              const c = cards?.find(c => c.id === selected.id)
              return c ? (
                <CardDetailBody
                  card={c}
                  wallets={wallets ?? []}
                  onOpenWallet={openWallet}
                  onOpenAddress={openAddress}
                />
              ) : null
            })()}
        </div>
      </DialogContent>
    </Dialog>
  )
}
