'use client'

import React, { useState } from 'react'
import { AtSign, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import {
  useAddressMutations,
  type WalletAddress,
} from '@/lib/client/hooks/use-wallet-addresses'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import { BindingChip, type BindingTone } from './binding-chip'
import { WalletPickerDrawer, type PickerRow } from './wallet-picker-drawer'

interface Props {
  addresses: WalletAddress[]
  wallets: RemoteWalletData[]
  /** Open the shared detail dialog for this address. */
  onOpenDetail: (username: string) => void
}

/** Resolve the chip label + tone for an address's current binding. */
function chipFor(
  addr: WalletAddress,
  wallets: RemoteWalletData[],
): { label: string; tone: BindingTone } {
  if (addr.mode === 'CUSTOM_NWC') {
    const w = wallets.find(w => w.id === addr.remoteWalletId)
    return { label: w?.name ?? 'Unknown wallet', tone: 'bound' }
  }
  if (addr.mode === 'DEFAULT_NWC') return { label: 'Default', tone: 'default' }
  if (addr.mode === 'ALIAS') return { label: 'Alias', tone: 'none' }
  return { label: 'Idle', tone: 'none' }
}

/**
 * Addresses tab (mobile). One row per Lightning Address: identity +
 * mode badge + tappable bound-wallet chip. Tapping the chip opens a
 * bottom-sheet picker that rebinds via the same
 * `PUT /api/wallet/addresses/:username` the desktop canvas uses
 * (CUSTOM_NWC / DEFAULT_NWC / IDLE). Tapping the row body opens the
 * shared detail dialog.
 */
export function AddressTab({ addresses, wallets, onOpenDetail }: Props) {
  const { updateAddress, updating } = useAddressMutations()
  // The address whose picker sheet is open (null = closed).
  const [picker, setPicker] = useState<WalletAddress | null>(null)

  async function rebind(
    addr: WalletAddress,
    choice:
      | { kind: 'wallet'; walletId: string }
      | { kind: 'default' }
      | { kind: 'idle' },
  ) {
    try {
      if (choice.kind === 'wallet') {
        await updateAddress(addr.username, {
          mode: 'CUSTOM_NWC',
          remoteWalletId: choice.walletId,
        })
      } else if (choice.kind === 'default') {
        await updateAddress(addr.username, { mode: 'DEFAULT_NWC' })
      } else {
        await updateAddress(addr.username, { mode: 'IDLE' })
      }
      toast.success(`${addr.username} updated`)
      setPicker(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update address')
    }
  }

  const pickerRows: PickerRow[] = picker
    ? [
        ...wallets.map(w => ({
          key: w.id,
          label: w.name,
          sublabel: w.isDefault ? 'Default wallet' : w.type,
          active: picker.mode === 'CUSTOM_NWC' && picker.remoteWalletId === w.id,
          tone: 'wallet' as const,
          onSelect: () => rebind(picker, { kind: 'wallet', walletId: w.id }),
        })),
        {
          key: '__default__',
          label: 'Default wallet',
          sublabel: 'Route through your default',
          active: picker.mode === 'DEFAULT_NWC',
          tone: 'default' as const,
          onSelect: () => rebind(picker, { kind: 'default' }),
        },
        {
          key: '__idle__',
          label: 'Disconnect',
          sublabel: 'No wallet (idle)',
          active: picker.mode === 'IDLE',
          tone: 'danger' as const,
          onSelect: () => rebind(picker, { kind: 'idle' }),
        },
      ]
    : []

  if (addresses.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-muted-foreground">
        No lightning addresses yet.
      </p>
    )
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {addresses.map(addr => {
          const chip = chipFor(addr, wallets)
          return (
            <li key={addr.username}>
              <button
                type="button"
                onClick={() => onOpenDetail(addr.username)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/40"
              >
                <AtSign className="size-4 shrink-0 text-emerald-400" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1 truncate text-sm font-medium">
                    <span className="truncate">{addr.username}</span>
                    {addr.isPrimary && (
                      <Star
                        className="size-3 shrink-0 fill-amber-400 text-amber-400"
                        aria-label="Primary"
                      />
                    )}
                  </span>
                  <Badge
                    variant="outline"
                    className="mt-0.5 w-fit text-[10px] font-normal"
                  >
                    {addr.mode}
                  </Badge>
                </div>
                <BindingChip
                  label={chip.label}
                  tone={chip.tone}
                  onClick={() => setPicker(addr)}
                />
              </button>
            </li>
          )
        })}
      </ul>

      <WalletPickerDrawer
        open={picker !== null}
        onOpenChange={o => !o && setPicker(null)}
        title={picker ? `Bind ${picker.username}` : 'Bind address'}
        rows={pickerRows}
        busy={updating}
      />
    </>
  )
}
