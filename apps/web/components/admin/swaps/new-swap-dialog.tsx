'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { SwapWizard } from './swap-wizard'

/**
 * Hosts the swap wizard. It can't be dismissed while a payment is in flight,
 * and outside clicks never close it — the flow is too long to lose by a
 * stray click.
 */
export function NewSwapDialog({
  open,
  onOpenChange,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (swapId: string) => void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!busy) onOpenChange(next)
      }}
    >
      <DialogContent
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => {
          // Escape in an open recipient dropdown only closes the dropdown.
          const openCombobox =
            document.activeElement?.getAttribute('aria-expanded') === 'true'
          if (busy || openCombobox) e.preventDefault()
        }}
        className={cn(
          'max-h-[100dvh] max-w-xl gap-0 overflow-y-auto p-0',
          busy && '[&>button:last-child]:hidden'
        )}
      >
        <DialogTitle className="sr-only">New swap</DialogTitle>
        <DialogDescription className="sr-only">
          Send pesos to an Argentine bank account, paid from your Lightning
          wallet.
        </DialogDescription>
        {open && <SwapWizard bare onBusyChange={setBusy} onDone={onCreated} />}
      </DialogContent>
    </Dialog>
  )
}
