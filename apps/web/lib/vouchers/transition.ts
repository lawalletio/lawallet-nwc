import type { VoucherStatus } from '@/lib/validation/schemas'

/**
 * Statuses a voucher can never leave.
 *
 * A burned coupon must stay burned. The status refresh talks to a third-party
 * service over the network, so a `minted` answer after a `claimed` one is not
 * evidence the coupon is spendable again — it is far more likely a service
 * rollback, a nonce collision, or a spoofed response. Treating CLAIMED and
 * VOIDED as absorbing states means the worst a bad answer can do is show a
 * stale-but-safe "Redeemed".
 */
const TERMINAL: readonly VoucherStatus[] = ['CLAIMED', 'VOIDED']

/** Whether `status` can still change. */
export function isTerminalVoucherStatus(status: VoucherStatus): boolean {
  return TERMINAL.includes(status)
}

/**
 * Resolve the status to persist after a service reported `reported`.
 *
 * EXPIRED is deliberately *not* terminal: a coupon claimed moments before it
 * expired can be reported late, and the claim is the more meaningful fact. It
 * can also legitimately be voided after expiry.
 */
export function nextVoucherStatus(
  current: VoucherStatus,
  reported: VoucherStatus
): VoucherStatus {
  if (isTerminalVoucherStatus(current)) return current
  return reported
}

/** Map a coupon service's lowercase status onto our enum. */
export function voucherStatusFromService(
  reported: 'minted' | 'claimed' | 'expired' | 'voided'
): VoucherStatus {
  switch (reported) {
    case 'claimed':
      return 'CLAIMED'
    case 'expired':
      return 'EXPIRED'
    case 'voided':
      return 'VOIDED'
    case 'minted':
      return 'MINTED'
  }
}
