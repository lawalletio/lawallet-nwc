'use client'

import React from 'react'
import { Check, Star, Wallet, X } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/**
 * One selectable row in the picker. The parent (Address / Card tab)
 * builds these so the drawer stays dumb — it doesn't know what a
 * "default wallet" or "disconnect" means, just renders rows and fires
 * `onSelect`.
 */
export interface PickerRow {
  key: string
  label: string
  sublabel?: string
  active: boolean
  /** Visual accent: a real wallet, the default-wallet option, or a destructive (disconnect) option. */
  tone: 'wallet' | 'default' | 'danger'
  onSelect: () => void
}

/**
 * Bottom-sheet wallet picker for rebinding an Address or Card on
 * mobile. Generic list of `PickerRow`s + a busy overlay while the
 * rebind mutation is in flight (the sheet stays open so the user sees
 * the spinner, then the parent closes it on success).
 */
export function WalletPickerDrawer({
  open,
  onOpenChange,
  title,
  rows,
  busy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  rows: PickerRow[]
  busy?: boolean
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[80vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <div className="relative flex flex-col gap-1 overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {rows.map(row => (
            <button
              key={row.key}
              type="button"
              onClick={row.onSelect}
              disabled={busy}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors disabled:opacity-50',
                row.active ? 'bg-accent' : 'hover:bg-muted/60',
              )}
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full',
                  row.tone === 'danger' ? 'bg-destructive/10' : 'bg-muted',
                )}
              >
                {row.tone === 'default' ? (
                  <Star className="size-4 fill-amber-400 text-amber-400" />
                ) : row.tone === 'danger' ? (
                  <X className="size-4 text-destructive" />
                ) : (
                  <Wallet className="size-4 text-amber-400" />
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{row.label}</span>
                {row.sublabel && (
                  <span className="truncate text-xs text-muted-foreground">
                    {row.sublabel}
                  </span>
                )}
              </span>
              {row.active && <Check className="size-4 shrink-0 text-foreground" />}
            </button>
          ))}

          {busy && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Spinner size={24} className="text-muted-foreground" />
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
