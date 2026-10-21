'use client'

import { useRef } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { useT } from '@/lib/client/i18n'

export interface RecoverySide {
  lightningAddresses: string[]
  cards: number
  remoteWallets: number
}

/**
 * Asks before a RECOVER claim merges the card's account into an account that
 * already has data. Lists both sides so the user sees what mixes.
 */
export function RecoverMergeDialog({
  open,
  existing,
  incoming,
  onConfirm,
  onCancel
}: {
  open: boolean
  existing: RecoverySide
  incoming: RecoverySide
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useT().activate.recover.merge
  // AlertDialogAction also closes the dialog; don't report that as a cancel.
  const confirmed = useRef(false)

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next && !confirmed.current) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.title}</AlertDialogTitle>
          <AlertDialogDescription>{t.body}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <SideSummary label={t.yours} side={existing} />
          <SideSummary label={t.incoming} side={incoming} highlight />
        </div>
        <p className="text-xs text-muted-foreground">{t.keepsPrimary}</p>

        <AlertDialogFooter>
          <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              confirmed.current = true
              onConfirm()
            }}
          >
            {t.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SideSummary({
  label,
  side,
  highlight
}: {
  label: string
  side: RecoverySide
  highlight?: boolean
}) {
  const t = useT().activate.recover.merge
  return (
    <div
      className={
        highlight
          ? 'rounded-xl border border-primary/40 bg-primary/5 p-3'
          : 'rounded-xl border border-border bg-card p-3'
      }
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {side.lightningAddresses.length > 0 ? (
          side.lightningAddresses.map(address => (
            <li key={address} className="truncate font-medium text-foreground">
              {address}
            </li>
          ))
        ) : (
          <li className="text-muted-foreground">{t.noAddress}</li>
        )}
        <li className="text-muted-foreground">
          {t.cards(side.cards)} · {t.wallets(side.remoteWallets)}
        </li>
      </ul>
    </div>
  )
}
