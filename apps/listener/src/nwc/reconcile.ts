import type { DesiredWallet } from '../db'

export interface CurrentWallet {
  id: string
  connectionString: string
}

export interface WalletDiff {
  add: DesiredWallet[]
  remove: string[]
  /** In both sets but the connection string changed (URI rotation). */
  update: DesiredWallet[]
}

/**
 * Pure diff between the pool's current connections and the desired set from
 * Postgres. Metadata-only changes (name, user) are neither add nor update —
 * the pool refreshes those in place without touching the relay connection.
 */
export function diffWallets(
  current: CurrentWallet[],
  desired: DesiredWallet[]
): WalletDiff {
  const currentById = new Map(current.map(w => [w.id, w]))
  const desiredIds = new Set(desired.map(w => w.id))

  const add: DesiredWallet[] = []
  const update: DesiredWallet[] = []

  for (const wallet of desired) {
    const existing = currentById.get(wallet.id)
    if (!existing) {
      add.push(wallet)
    } else if (existing.connectionString !== wallet.connectionString) {
      update.push(wallet)
    }
  }

  const remove = current.filter(w => !desiredIds.has(w.id)).map(w => w.id)

  return { add, remove, update }
}
