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
  CLAIMED: { label: 'Redeemed', variant: 'secondary' },
  EXPIRED: { label: 'Expired', variant: 'outline' },
  VOIDED: { label: 'Voided', variant: 'destructive' }
}

export function VoucherStatusBadge({ status }: { status: VoucherStatus }) {
  const { label, variant } = LABELS[status] ?? LABELS.MINTED
  return <Badge variant={variant}>{label}</Badge>
}

/** Whether a voucher should render dimmed — it can no longer be spent. */
export function isSpent(status: VoucherStatus): boolean {
  return status !== 'MINTED'
}
