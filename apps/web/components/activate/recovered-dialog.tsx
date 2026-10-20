'use client'

import { useEffect, useState } from 'react'
import { CreditCard, Wallet, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/components/admin/auth-context'
import { formatSatsAmount } from '@/lib/client/format-sats'
import { useT } from '@/lib/client/i18n'

/** The `recovery` block of a RECOVER claim response. */
export interface RecoveredAccount {
  lightningAddresses: string[]
  primaryAddress: string | null
  cards: { id: string; title: string | null; designImageUrl: string | null }[]
  remoteWallets: { id: string; name: string; isDefault: boolean }[]
  vouchers: number
  mergedIntoExisting: boolean
}

/** `undefined` = loading, `null` = unavailable. */
type Balance = number | null | undefined

/**
 * Shown once a RECOVER claim lands: what came over from the card's account —
 * addresses, cards, remote wallets — with each wallet's live balance read
 * through the (now owned) `GET /api/remote-wallets/:id/balance`.
 */
export function RecoveredDialog({
  open,
  recovery,
  claimAddress,
  onContinue
}: {
  open: boolean
  recovery: RecoveredAccount
  /** The account still has no lightning address: continue to claim one. */
  claimAddress: boolean
  onContinue: () => void
}) {
  const t = useT().activate.recover.done
  const { apiClient } = useAuth()
  const [balances, setBalances] = useState<Record<string, Balance>>({})

  useEffect(() => {
    if (!open) return
    let cancelled = false
    for (const wallet of recovery.remoteWallets) {
      apiClient
        .get<{ balanceSats: number }>(
          `/api/remote-wallets/${wallet.id}/balance`
        )
        .then(res => res.balanceSats)
        .catch(() => null)
        .then(balance => {
          if (!cancelled) {
            setBalances(prev => ({ ...prev, [wallet.id]: balance }))
          }
        })
    }
    return () => {
      cancelled = true
    }
  }, [open, recovery.remoteWallets, apiClient])

  const known = recovery.remoteWallets
    .map(w => balances[w.id])
    .filter((b): b is number => typeof b === 'number')
  const loading = recovery.remoteWallets.some(w => balances[w.id] === undefined)
  const total = known.reduce((sum, b) => sum + b, 0)

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onContinue()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>
            {recovery.mergedIntoExisting ? t.merged : t.body}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-2xl bg-card p-4 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t.totalBalance}
          </p>
          {loading && known.length === 0 ? (
            <Skeleton className="mx-auto mt-2 h-8 w-32" />
          ) : known.length > 0 ? (
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {formatSatsAmount(total, 'SAT', null)}{' '}
              <span className="text-base font-normal text-muted-foreground">
                sats
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {recovery.remoteWallets.length > 0 ? t.unavailable : t.none}
            </p>
          )}
        </div>

        <Section icon={<Zap className="size-4" />} title={t.addresses}>
          {recovery.lightningAddresses.length > 0 ? (
            recovery.lightningAddresses.map(address => (
              <Row key={address} label={address} />
            ))
          ) : (
            <Row label={t.none} muted />
          )}
        </Section>

        <Section icon={<CreditCard className="size-4" />} title={t.cards}>
          {recovery.cards.length > 0 ? (
            recovery.cards.map(card => (
              <Row
                key={card.id}
                label={card.title || t.untitledCard}
                leading={
                  card.designImageUrl ? (
                    <img
                      src={card.designImageUrl}
                      alt=""
                      className="h-6 w-10 rounded object-cover"
                    />
                  ) : undefined
                }
              />
            ))
          ) : (
            <Row label={t.none} muted />
          )}
        </Section>

        <Section icon={<Wallet className="size-4" />} title={t.wallets}>
          {recovery.remoteWallets.length > 0 ? (
            recovery.remoteWallets.map(wallet => (
              <Row
                key={wallet.id}
                label={wallet.name}
                badge={wallet.isDefault ? t.defaultWallet : undefined}
                value={<WalletBalance balance={balances[wallet.id]} />}
              />
            ))
          ) : (
            <Row label={t.none} muted />
          )}
        </Section>

        {recovery.vouchers > 0 && (
          <p className="text-sm text-muted-foreground">
            {t.vouchers(recovery.vouchers)}
          </p>
        )}

        <Button
          variant="theme"
          className="h-12 w-full text-base font-semibold"
          onClick={onContinue}
        >
          {claimAddress ? t.claimAddress : t.openWallet}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

function WalletBalance({ balance }: { balance: Balance }) {
  const t = useT().activate.recover.done
  if (balance === undefined) return <Skeleton className="h-4 w-16" />
  if (balance === null) {
    return <span className="text-muted-foreground">{t.unavailable}</span>
  }
  return <span>{formatSatsAmount(balance, 'SAT', null)} sats</span>
}

function Section({
  icon,
  title,
  children
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h3>
      <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card">
        {children}
      </div>
    </section>
  )
}

function Row({
  label,
  leading,
  badge,
  value,
  muted
}: {
  label: string
  leading?: React.ReactNode
  badge?: string
  value?: React.ReactNode
  muted?: boolean
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
      {leading}
      <span
        className={
          muted
            ? 'min-w-0 flex-1 truncate text-muted-foreground'
            : 'min-w-0 flex-1 truncate font-medium text-foreground'
        }
      >
        {label}
      </span>
      {badge && (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
          {badge}
        </span>
      )}
      {value && <span className="shrink-0 text-sm">{value}</span>}
    </div>
  )
}
