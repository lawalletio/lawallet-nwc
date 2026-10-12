/**
 * Payer wallets poll LUD-21 verify every 1–2s, and each pending poll used to
 * cost an NWC `lookup_invoice` round-trip. The listener webhook marks invoices
 * PAID on its own, so the wallet only needs asking now and then: polls inside
 * the window answer from the row. Per instance and bounded — a miss just means
 * one extra lookup.
 */
const LOOKUP_MIN_INTERVAL_MS = 5_000
const LOOKUP_THROTTLE_MAX_ENTRIES = 1_000
const lastLookupAt = new Map<string, number>()

/** Whether to ask the wallet now; records the attempt when it says yes. */
export function shouldLookupInvoice(
  paymentHash: string,
  now = Date.now()
): boolean {
  const last = lastLookupAt.get(paymentHash)
  if (last !== undefined && now - last < LOOKUP_MIN_INTERVAL_MS) return false
  // Re-insert so Map order tracks recency; evict the oldest past the cap.
  lastLookupAt.delete(paymentHash)
  lastLookupAt.set(paymentHash, now)
  if (lastLookupAt.size > LOOKUP_THROTTLE_MAX_ENTRIES) {
    lastLookupAt.delete(lastLookupAt.keys().next().value!)
  }
  return true
}
