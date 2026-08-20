'use client'

import { Badge } from '@/components/ui/badge'
import type { VoucherStatus } from '@/lib/client/hooks/use-vouchers'

const LABELS: Record<
  VoucherStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
  }
> = {
  // "Available" rather than "Minted": the protocol word describes what the
  // service did, the user cares whether they can spend it.
  MINTED: { label: 'Available', variant: 'default' },
  TRANSFER_PENDING: { label: 'Sending…', variant: 'outline' },
  // "Sent", not "Transferred": the user's mental model is a thing they gave
  // away, not a state machine transition.
  TRANSFERRED: { label: 'Sent', variant: 'secondary' },
  CLAIMED: { label: 'Redeemed', variant: 'secondary' },
  EXPIRED: { label: 'Expired', variant: 'outline' },
  VOIDED: { label: 'Voided', variant: 'destructive' }
}

export function VoucherStatusBadge({ status }: { status: VoucherStatus }) {
  const { label, variant } = LABELS[status] ?? LABELS.MINTED
  return <Badge variant={variant}>{label}</Badge>
}

/** Whether a voucher should render dimmed — it can no longer be spent here. */
export function isSpent(status: VoucherStatus): boolean {
  return status !== 'MINTED'
}

/**
 * Whether this voucher can still be handed to someone.
 *
 * Stricter than `!isSpent`: a send already in flight must not start a second
 * one, even though the coupon is technically still ours until it lands.
 */
export function canSend(voucher: {
  status: VoucherStatus
  refreshUrl: string | null
}): boolean {
  return voucher.status === 'MINTED' && Boolean(voucher.refreshUrl)
}
