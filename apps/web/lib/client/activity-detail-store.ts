import type { NwcTransaction } from '@/lib/client/nwc/transactions'

/**
 * In-memory stash so tapping an Activity row can open the detail screen
 * with the same payload immediately, before IndexedDB / lookup_invoice
 * resolve. A full reload falls back to those slower sources.
 */
const byHash = new Map<string, NwcTransaction>()

export function rememberActivityTx(tx: NwcTransaction): void {
  const hash = tx.paymentHash?.trim()
  if (!hash) return
  byHash.set(hash, tx)
}

export function recallActivityTx(paymentHash: string): NwcTransaction | null {
  const hash = paymentHash.trim()
  if (!hash) return null
  return byHash.get(hash) ?? null
}

/** Test-only: drop remembered rows between cases. */
export function __resetActivityDetailStoreForTests(): void {
  byHash.clear()
}
