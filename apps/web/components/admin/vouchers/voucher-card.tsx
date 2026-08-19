'use client'

import Link from 'next/link'
import { RefreshCw, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DesignImage } from '@/components/admin/design-image'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useNostrProfile } from '@/lib/client/nostr-profile'
import { npubInitials, truncateNpub } from '@/lib/client/format'
import { formatBenefit, formatBenefitCap } from '@/lib/vouchers/benefit'
import { useNow } from '@/lib/client/hooks/use-now'
import type { Voucher } from '@/lib/client/hooks/use-vouchers'
import {
  isSpent,
  VoucherStatusBadge
} from '@/components/admin/vouchers/voucher-status-badge'
import { cn } from '@/lib/utils'

export function VoucherCard({
  voucher,
  onRefresh,
  refreshing
}: {
  voucher: Voucher
  onRefresh: () => void
  refreshing: boolean
}) {
  const benefit = formatBenefit(voucher.metadata?.coupon)
  const cap = formatBenefitCap(voucher.metadata?.coupon)
  const spent = isSpent(voucher.status)

  return (
    <article
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-shadow hover:shadow-md',
        // A spent coupon still belongs in the stash as a record, but it should
        // never compete for attention with one that can still be used.
        spent && 'opacity-60 grayscale'
      )}
    >
      <Link
        href={`/admin/vouchers/${voucher.id}`}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DesignImage
          src={voucher.imageUrl}
          alt=""
          className="rounded-none border-b border-border"
        />
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 font-semibold leading-tight">
            <Link
              href={`/admin/vouchers/${voucher.id}`}
              className="hover:underline"
            >
              {voucher.name}
            </Link>
          </h3>
          <VoucherStatusBadge status={voucher.status} />
        </div>

        {benefit ? (
          <p className="text-sm font-medium text-foreground">
            {benefit}
            {cap ? (
              <span className="font-normal text-muted-foreground"> {cap}</span>
            ) : null}
          </p>
        ) : null}

        {voucher.description ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {voucher.description}
          </p>
        ) : null}

        <MerchantChip pubkey={voucher.merchantPubkey} />

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <ExpiryNote voucher={voucher} />
          {/* Terminal statuses can't change, so the refresh would be a no-op
              round-trip against somebody else's service. */}
          {spent ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label={`Refresh status of ${voucher.name}`}
            >
              <RefreshCw
                data-icon="inline-start"
                className={cn(refreshing && 'animate-spin')}
              />
              Refresh
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}

function MerchantChip({ pubkey }: { pubkey: string }) {
  const { profile } = useNostrProfile(pubkey)
  const name = profile?.displayName || profile?.name || truncateNpub(pubkey, 6)

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Avatar className="size-5">
        {profile?.picture ? <AvatarImage src={profile.picture} alt="" /> : null}
        <AvatarFallback className="text-[9px]">
          {npubInitials(pubkey)}
        </AvatarFallback>
      </Avatar>
      <Store className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{name}</span>
    </div>
  )
}

function ExpiryNote({ voucher }: { voucher: Voucher }) {
  const now = useNow()

  if (voucher.status === 'CLAIMED' && voucher.claimedAt) {
    return (
      <p className="text-xs text-muted-foreground">
        Redeemed {new Date(voucher.claimedAt).toLocaleDateString()}
      </p>
    )
  }
  if (!voucher.expiresAt) return <span />

  const expires = new Date(voucher.expiresAt)
  const days = Math.ceil((expires.getTime() - now) / 86_400_000)

  return (
    <p
      className={cn(
        'text-xs text-muted-foreground',
        days <= 3 && days > 0 && 'font-medium text-foreground'
      )}
    >
      {days <= 0
        ? `Expired ${expires.toLocaleDateString()}`
        : days === 1
          ? 'Expires tomorrow'
          : `Expires in ${days} days`}
    </p>
  )
}
