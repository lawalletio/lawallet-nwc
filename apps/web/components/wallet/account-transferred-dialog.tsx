'use client'

import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useApi, useMutation } from '@/lib/client/hooks/use-api'
import { useLocale, useT } from '@/lib/client/i18n'

/** `accountTransfer` on `GET /api/users/me`. */
export interface AccountTransferNotice {
  id: string
  transferredAt: string
  cardTitle: string | null
  lightningAddresses: string[]
  cards: number
  remoteWallets: number
}

/**
 * Tells the old owner that a card recovery moved their account to another
 * key: when, with which card, and what moved. Stays until dismissed
 * (server-side, so it follows them across devices). It appears on the next
 * `/api/users/me` load — `users:updated` is gated on USERS_READ, so a plain
 * user's open session isn't pushed the change.
 */
export function AccountTransferredDialog() {
  const t = useT().settings.accountTransfer
  const locale = useLocale()
  const { data } = useApi<{ accountTransfer?: AccountTransferNotice | null }>(
    '/api/users/me'
  )
  const { mutate, loading } = useMutation(['/api/users/me'])
  const [dismissedId, setDismissedId] = useState<string | null>(null)

  const notice = data?.accountTransfer ?? null
  if (!notice || notice.id === dismissedId) return null

  const date = formatDate(notice.transferredAt, locale)

  async function handleDismiss() {
    if (!notice) return
    // Hide right away; the server ack makes it stick across devices.
    setDismissedId(notice.id)
    try {
      await mutate('post', '/api/users/me/account-transfer/dismiss')
    } catch {
      // Shown again next load — better than losing the notice.
    }
  }

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) void handleDismiss()
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-destructive/10">
            <ShieldAlert className="size-6 text-destructive" />
          </div>
          <DialogTitle className="text-center">{t.title}</DialogTitle>
          <DialogDescription className="text-center">
            {t.body(date, notice.cardTitle || t.unnamedCard)}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl bg-card p-4 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t.moved}
          </p>
          <ul className="mt-2 space-y-1">
            {notice.lightningAddresses.map(address => (
              <li
                key={address}
                className="truncate font-medium text-foreground"
              >
                {address}
              </li>
            ))}
            <li className="text-muted-foreground">
              {t.cards(notice.cards)} · {t.wallets(notice.remoteWallets)}
            </li>
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">{t.notYou}</p>

        <Button
          className="h-12 w-full"
          disabled={loading}
          onClick={() => void handleDismiss()}
        >
          {t.dismiss}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

function formatDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, { dateStyle: 'medium' })
  } catch {
    return iso.slice(0, 10)
  }
}
