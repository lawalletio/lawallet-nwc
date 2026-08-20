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
 *
 * TRANSFERRED absorbs for the same reason: the nonce on this row was burned
 * by the recipient's refresh, so nothing the service says can make it
 * spendable again.
 *
 * TRANSFER_PENDING is deliberately NOT terminal — it is the in-flight state,
 * and settling it is the whole point.
 */
const TERMINAL: readonly VoucherStatus[] = ['CLAIMED', 'VOIDED', 'TRANSFERRED']

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

/**
 * Map a coupon service's lowercase status onto our enum.
 *
 * Returns null for a status this build doesn't know. Services are free to
 * grow their vocabulary, and guessing at an unfamiliar value is worse than
 * admitting ignorance: the caller leaves the stored status untouched rather
 * than inventing a transition from a word it can't interpret.
 */
export function voucherStatusFromService(
  reported: string | undefined | null
): VoucherStatus | null {
  switch (reported) {
    case 'claimed':
      return 'CLAIMED'
    case 'expired':
      return 'EXPIRED'
    case 'voided':
      return 'VOIDED'
    case 'minted':
      return 'MINTED'
    // The nonce was swapped for a replacement — somebody else holds the value
    // now. From this row's point of view that is indistinguishable in effect
    // from having sent it, which is exactly what TRANSFERRED means.
    case 'refreshed':
      return 'TRANSFERRED'
    default:
      return null
  }
}
