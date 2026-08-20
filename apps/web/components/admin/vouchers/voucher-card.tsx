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
        className="relative block overflow-hidden border-b border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* The zoom lives on a wrapper, not on DesignImage's `img`, so it
            doesn't fight that element's own opacity transition — and so the
            "No image" placeholder zooms identically. `overflow-hidden` on the
            link is what crops the overshoot. */}
        <div className="transition-transform duration-500 ease-out group-hover:scale-[1.06] motion-reduce:transition-none motion-reduce:group-hover:scale-100">
          <DesignImage src={voucher.imageUrl} alt="" className="rounded-none" />
        </div>
        <MerchantOverlay pubkey={voucher.merchantPubkey} />
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

/**
 * Who issued this coupon, laid over the artwork.
 *
 * The merchant is the single most useful thing to know at a glance in a grid
 * — "is this the cafe near me?" — so it rides on the art rather than
 * competing with the benefit text below. The scrim is what makes it legible:
 * voucher images come from arbitrary merchants and can be any colour, so
 * white text alone is a coin flip.
 */
function MerchantOverlay({ pubkey }: { pubkey: string }) {
  const { profile } = useNostrProfile(pubkey)
  const name = profile?.displayName || profile?.name || truncateNpub(pubkey, 6)

  return (
    // Recedes on hover rather than disappearing: the merchant is why you
    // recognise the card, so it stays legible enough to keep your place while
    // the artwork it was covering comes forward.
    <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2.5 bg-gradient-to-b from-black/70 via-black/35 to-transparent p-3 pb-8 transition-opacity duration-300 ease-out group-hover:opacity-30 motion-reduce:transition-none">
      <Avatar className="size-9 shrink-0 ring-1 ring-white/25">
        {profile?.picture ? <AvatarImage src={profile.picture} alt="" /> : null}
        <AvatarFallback className="bg-black/50 text-[11px] font-medium text-white">
          {npubInitials(pubkey)}
        </AvatarFallback>
      </Avatar>
      <Store className="size-3.5 shrink-0 text-white/70" aria-hidden />
      <span className="truncate text-sm font-medium text-white drop-shadow-sm">
        {name}
      </span>
    </div>
  )
}

function ExpiryNote({ voucher }: { voucher: Voucher }) {
  const now = useNow()

  if (voucher.status === 'TRANSFERRED') {
    return (
      <p className="truncate text-xs text-muted-foreground">
        Sent{voucher.transferredTo ? ` to ${voucher.transferredTo}` : ''}
      </p>
    )
  }
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
