'use client'

import React, { useState } from 'react'
import { CreditCard } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { truncateHex } from '@/lib/client/format'
import { useCardMutations, type CardData } from '@/lib/client/hooks/use-cards'
import type { RemoteWalletData } from '@/lib/client/hooks/use-remote-wallets'
import { BindingChip, type BindingTone } from './binding-chip'
import { WalletPickerDrawer, type PickerRow } from './wallet-picker-drawer'

interface Props {
  cards: CardData[]
  wallets: RemoteWalletData[]
  onOpenDetail: (cardId: string) => void
}

function chipFor(
  card: CardData,
  wallets: RemoteWalletData[],
): { label: string; tone: BindingTone } {
  if (card.remoteWalletId) {
    const w = wallets.find(w => w.id === card.remoteWalletId)
    return { label: w?.name ?? 'Unknown wallet', tone: 'bound' }
  }
  // Unbound cards spend through the owner's default wallet at run-time.
  return { label: 'Default', tone: 'default' }
}

/**
 * Cards tab (mobile). One row per Card: design thumb + name + paired
 * badge + tappable bound-wallet chip. The chip opens a bottom-sheet
 * picker that rebinds via `PATCH /api/cards/:id` (a specific wallet or
 * "use default" which clears `remoteWalletId`). Row body → detail
 * dialog.
 *
 * Cards come from the per-caller `/api/wallet/cards`, so the list is always
 * the cards paired to the logged-in account (an admin sees only their own).
 */
export function CardTab({ cards, wallets, onOpenDetail }: Props) {
  const { updateCard, updating } = useCardMutations()
  const [picker, setPicker] = useState<CardData | null>(null)

  async function rebind(card: CardData, walletId: string | null) {
    try {
      await updateCard(card.id, { remoteWalletId: walletId })
      toast.success('Card updated')
      setPicker(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update card')
    }
  }

  const pickerRows: PickerRow[] = picker
    ? [
        ...wallets.map(w => ({
          key: w.id,
          label: w.name,
          sublabel: w.isDefault ? 'Default wallet' : w.type,
          active: picker.remoteWalletId === w.id,
          tone: 'wallet' as const,
          onSelect: () => rebind(picker, w.id),
        })),
        {
          key: '__default__',
          label: 'Use default wallet',
          sublabel: 'Spend through your default',
          active: picker.remoteWalletId === null,
          tone: 'default' as const,
          onSelect: () => rebind(picker, null),
        },
      ]
    : []

  if (cards.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-muted-foreground">
        No cards yet.
      </p>
    )
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {cards.map(card => {
          const chip = chipFor(card, wallets)
          const title =
            card.title ?? card.lightningAddress?.username ?? truncateHex(card.id)
          return (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => onOpenDetail(card.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-muted/40"
              >
                {card.design?.image ? (
                  <img
                    src={card.design.image}
                    alt={card.design.description ?? 'Card design'}
                    className="h-8 w-12 shrink-0 rounded-sm border border-border object-cover"
                  />
                ) : (
                  <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded-sm border border-border bg-muted">
                    <CreditCard className="size-4 text-sky-400" />
                  </span>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{title}</span>
                  <Badge
                    variant={
                      card.blocked
                        ? 'destructive'
                        : card.lightningAddress
                          ? 'default'
                          : 'secondary'
                    }
                    className="mt-0.5 w-fit text-[10px] font-normal"
                  >
                    {card.blocked
                      ? 'Blocked'
                      : card.lightningAddress
                        ? 'Paired'
                        : 'Unpaired'}
                  </Badge>
                </div>
                <BindingChip
                  label={chip.label}
                  tone={chip.tone}
                  onClick={() => setPicker(card)}
                />
              </button>
            </li>
          )
        })}
      </ul>

      <WalletPickerDrawer
        open={picker !== null}
        onOpenChange={o => !o && setPicker(null)}
        title="Bind card"
        rows={pickerRows}
        busy={updating}
      />
    </>
  )
}
