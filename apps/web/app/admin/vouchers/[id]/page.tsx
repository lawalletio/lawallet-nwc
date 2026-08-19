'use client'

import React from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ChevronLeft,
  Eye,
  EyeOff,
  RefreshCw,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import { toast } from 'sonner'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { CopyButton } from '@/components/ui/copy-button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible'
import { DesignImage } from '@/components/admin/design-image'
import { QrDisplay } from '@/components/wallet/shared/qr-display'
import { NpubIdentity } from '@/components/admin/vouchers/npub-identity'
import {
  isSpent,
  VoucherStatusBadge
} from '@/components/admin/vouchers/voucher-status-badge'
import { formatBenefit, formatBenefitCap } from '@/lib/vouchers/benefit'
import { truncateNpub } from '@/lib/client/format'
import { useNow } from '@/lib/client/hooks/use-now'
import {
  useVoucher,
  useVoucherMutations,
  type Voucher
} from '@/lib/client/hooks/use-vouchers'

export default function VoucherDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { data: voucher, loading, error, refetch } = useVoucher(params.id)
  const { refreshVoucher, deleteVoucher, deleting } = useVoucherMutations()
  const [refreshing, setRefreshing] = React.useState(false)

  async function handleRefresh() {
    if (!voucher) return
    setRefreshing(true)
    try {
      const { checked } = await refreshVoucher(voucher.id)
      await refetch()
      toast.success(checked ? 'Status refreshed' : 'Already up to date')
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not reach the service'
      )
    } finally {
      setRefreshing(false)
    }
  }

  async function handleDelete() {
    if (!voucher) return
    const confirmed = window.confirm(
      `Remove “${voucher.name}” from your vouchers? This only removes your copy — the coupon itself stays valid at the merchant.`
    )
    if (!confirmed) return
    try {
      await deleteVoucher(voucher.id)
      toast.success('Voucher removed')
      router.replace('/admin/vouchers')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove it')
    }
  }

  return (
    <div className="flex flex-col">
      <AdminTopbar
        title={voucher?.name ?? 'Voucher'}
        type="subpage"
        onBack={() => router.push('/admin/vouchers')}
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
        <Link
          href="/admin/vouchers"
          className="hidden w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:inline-flex"
        >
          <ChevronLeft className="size-4" />
          All vouchers
        </Link>

        {error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            Couldn’t load this voucher: {error.message}
          </div>
        ) : loading && !voucher ? (
          <DetailSkeleton />
        ) : !voucher ? null : (
          <>
            <Hero voucher={voucher} />
            <NonceSection voucher={voucher} />
            <BenefitSection voucher={voucher} />

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                Issued by
              </h2>
              <NpubIdentity pubkey={voucher.merchantPubkey} role="Merchant" />
              <NpubIdentity
                pubkey={voucher.servicePubkey}
                role="Coupon service"
              />
            </section>

            <Provenance voucher={voucher} />

            <div className="flex flex-wrap gap-2">
              {isSpent(voucher.status) ? null : (
                <Button
                  variant="outline"
                  onClick={handleRefresh}
                  disabled={refreshing}
                >
                  {refreshing ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <RefreshCw data-icon="inline-start" />
                  )}
                  Refresh status
                </Button>
              )}
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 data-icon="inline-start" />
                Remove
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Hero({ voucher }: { voucher: Voucher }) {
  const benefit = formatBenefit(voucher.metadata?.coupon)
  const cap = formatBenefitCap(voucher.metadata?.coupon)

  return (
    <section className="flex flex-col gap-4">
      <DesignImage src={voucher.imageUrl} alt="" className="rounded-xl" />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{voucher.name}</h1>
          <VoucherStatusBadge status={voucher.status} />
        </div>
        {benefit ? (
          <p className="text-lg font-medium">
            {benefit}
            {cap ? (
              <span className="font-normal text-muted-foreground"> {cap}</span>
            ) : null}
          </p>
        ) : null}
        {voucher.description ? (
          <p className="text-sm text-muted-foreground">{voucher.description}</p>
        ) : null}
        <Timing voucher={voucher} />
      </div>
    </section>
  )
}

function Timing({ voucher }: { voucher: Voucher }) {
  const now = useNow()

  if (voucher.status === 'CLAIMED' && voucher.claimedAt) {
    return (
      <p className="text-sm text-muted-foreground">
        Redeemed on {new Date(voucher.claimedAt).toLocaleString()}
      </p>
    )
  }
  if (!voucher.expiresAt) return null
  const expires = new Date(voucher.expiresAt)
  return (
    <p className="text-sm text-muted-foreground">
      {expires.getTime() < now ? 'Expired on' : 'Valid until'}{' '}
      {expires.toLocaleString()}
    </p>
  )
}

/**
 * The coupon code, shown as a QR for the till.
 *
 * The nonce is a bearer credential — anyone who reads it can redeem the
 * coupon. So it stays hidden until the user asks for it, and disappears
 * entirely once the coupon is spent, where showing it would only be a way to
 * leak a code that no longer buys anything.
 */
function NonceSection({ voucher }: { voucher: Voucher }) {
  const [revealed, setRevealed] = React.useState(false)

  if (isSpent(voucher.status)) {
    return (
      <section className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        This coupon has been {voucher.status.toLowerCase()}, so its code is no
        longer shown.
      </section>
    )
  }

  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6">
      <h2 className="text-sm font-medium text-muted-foreground">
        Show this at the till
      </h2>

      {revealed ? (
        <>
          <QrDisplay value={voucher.nonce} size={220} />
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 font-mono text-sm">
              {voucher.nonce}
            </code>
            <CopyButton value={voucher.nonce} label="Coupon code" />
          </div>
        </>
      ) : (
        <div className="flex h-[220px] w-[220px] items-center justify-center rounded-lg bg-muted">
          <EyeOff className="size-8 text-muted-foreground" />
        </div>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={() => setRevealed(current => !current)}
      >
        {revealed ? (
          <EyeOff data-icon="inline-start" />
        ) : (
          <Eye data-icon="inline-start" />
        )}
        {revealed ? 'Hide code' : 'Show code'}
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Anyone with this code can redeem the coupon.
      </p>
    </section>
  )
}

function BenefitSection({ voucher }: { voucher: Voucher }) {
  const coupon = voucher.metadata?.coupon
  if (!voucher.metadata || Object.keys(voucher.metadata).length === 0) {
    return null
  }
  const summary = formatBenefit(coupon)

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">Conditions</h2>
      {/* An unrecognized benefit type still has to be *readable* — the
          protocol's union grows upstream, and hiding what we can't summarize
          would leave the user unable to tell what they hold. */}
      {summary ? null : (
        <p className="text-sm text-muted-foreground">
          This coupon uses terms this version doesn’t summarize yet. The raw
          details are below.
        </p>
      )}
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
        {JSON.stringify(voucher.metadata, null, 2)}
      </pre>
    </section>
  )
}

function Provenance({ voucher }: { voucher: Voucher }) {
  return (
    <Collapsible className="rounded-xl border border-border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-4 text-left text-sm font-medium">
        <span className="flex items-center gap-2">
          {voucher.voucherEvent ? (
            <ShieldCheck className="size-4 text-muted-foreground" />
          ) : null}
          {voucher.voucherEvent
            ? 'Signed by the coupon service'
            : 'Deposit details'}
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          Details
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3 border-t border-border p-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Deposited by</dt>
          <dd className="font-mono text-xs">
            {truncateNpub(voucher.depositedBy, 12)}
          </dd>
          <dt className="text-muted-foreground">Received</dt>
          <dd>{new Date(voucher.createdAt).toLocaleString()}</dd>
          <dt className="text-muted-foreground">Last checked</dt>
          <dd>
            {voucher.statusCheckedAt
              ? new Date(voucher.statusCheckedAt).toLocaleString()
              : 'Never'}
          </dd>
          {voucher.couponId ? (
            <>
              <dt className="text-muted-foreground">Coupon ID</dt>
              <dd className="font-mono text-xs break-all">
                {voucher.couponId}
              </dd>
            </>
          ) : null}
        </dl>

        {voucher.voucherEvent ? (
          <>
            <p className="text-xs text-muted-foreground">
              The signed voucher event (kind 20402), stored as proof of origin.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
              {JSON.stringify(voucher.voucherEvent, null, 2)}
            </pre>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            This voucher arrived without a signed event, so its origin is only
            as trustworthy as the service that deposited it.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="aspect-video rounded-xl" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}
