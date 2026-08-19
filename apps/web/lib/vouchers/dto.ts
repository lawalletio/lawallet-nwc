import type { Prisma } from '@/lib/generated/prisma'
import type { VoucherStatus } from '@/lib/validation/schemas'

/** Fields every voucher endpoint returns. */
export const voucherSelect = {
  id: true,
  nonce: true,
  couponId: true,
  name: true,
  description: true,
  imageUrl: true,
  url: true,
  merchantPubkey: true,
  servicePubkey: true,
  claimUrl: true,
  mintUrl: true,
  metadata: true,
  voucherEvent: true,
  status: true,
  expiresAt: true,
  claimedAt: true,
  statusCheckedAt: true,
  depositedBy: true,
  createdAt: true
} satisfies Prisma.VoucherSelect

type VoucherRow = Prisma.VoucherGetPayload<{ select: typeof voucherSelect }>

export interface VoucherDto {
  id: string
  /**
   * The coupon code. Sent to the owner because presenting it *is* how the
   * coupon is redeemed — the list view keeps it hidden behind a toggle.
   */
  nonce: string
  couponId: string | null
  name: string
  description: string | null
  imageUrl: string | null
  /** Merchant's offer page. Always rendered with `rel="noopener noreferrer"`. */
  url: string | null
  merchantPubkey: string
  servicePubkey: string
  claimUrl: string
  mintUrl: string | null
  metadata: unknown
  voucherEvent: unknown
  status: VoucherStatus
  expiresAt: string | null
  claimedAt: string | null
  statusCheckedAt: string | null
  depositedBy: string
  createdAt: string
}

/**
 * `userId` is deliberately omitted — the caller already knows it is theirs,
 * and every one of these routes is owner-scoped.
 */
export function toVoucherDto(row: VoucherRow): VoucherDto {
  return {
    id: row.id,
    nonce: row.nonce,
    couponId: row.couponId,
    name: row.name,
    description: row.description,
    imageUrl: row.imageUrl,
    url: row.url,
    merchantPubkey: row.merchantPubkey,
    servicePubkey: row.servicePubkey,
    claimUrl: row.claimUrl,
    mintUrl: row.mintUrl,
    metadata: row.metadata ?? null,
    voucherEvent: row.voucherEvent ?? null,
    status: row.status as VoucherStatus,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    statusCheckedAt: row.statusCheckedAt?.toISOString() ?? null,
    depositedBy: row.depositedBy,
    createdAt: row.createdAt.toISOString()
  }
}
