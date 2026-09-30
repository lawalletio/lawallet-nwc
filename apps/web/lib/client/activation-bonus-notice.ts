const STORAGE_KEY = 'lawallet:activation-bonus-sats'

/** Same-tab fallback when sessionStorage is blocked (private mode). */
let memoryAmount: number | null = null

const listeners = new Set<() => void>()

function emitActivationBonus(): void {
  for (const listener of listeners) listener()
}

/** Server snapshot: the bonus is tab-local and must not affect SSR markup. */
export function serverActivationBonus(): null {
  return null
}

/** Subscribe for `useSyncExternalStore`. The snapshot is `readActivationBonus`. */
export function subscribeActivationBonus(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function parseAmount(raw: string | null): number | null {
  if (!raw) return null
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount <= 0) return null
  return Math.trunc(amount)
}

/**
 * Remember a sats bonus that the claim route actually paid, so the wallet
 * home can mention it after the Lightning-address step. Nothing is stored
 * when the instance bonus is off or the payment did not land — callers must
 * only pass a granted amount.
 */
export function rememberActivationBonus(amountSats: number): void {
  const amount = Math.trunc(amountSats)
  if (!Number.isFinite(amount) || amount <= 0) return
  memoryAmount = amount
  try {
    sessionStorage.setItem(STORAGE_KEY, String(amount))
  } catch {
    // Private mode can throw; the in-memory value still covers this tab.
  }
  emitActivationBonus()
}

/**
 * Persist a claim-response bonus only when the server marked it granted.
 * Returns the amount that was stored, or null when there is nothing to show.
 */
export function rememberGrantedActivationBonus(
  bonuses:
    { sats?: { granted?: boolean; amountSats?: number } } | null | undefined
): number | null {
  const sats = bonuses?.sats
  if (!sats?.granted) return null
  const amount = sats.amountSats
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return null
  }
  rememberActivationBonus(amount)
  return Math.trunc(amount)
}

/** Read without consuming, so the address-claim step can mention the credit. */
export function readActivationBonus(): number | null {
  if (memoryAmount != null) return memoryAmount
  try {
    const amount = parseAmount(sessionStorage.getItem(STORAGE_KEY))
    memoryAmount = amount
    return amount
  } catch {
    return null
  }
}

/** Drop the note for the rest of this tab. */
export function dismissActivationBonus(): void {
  memoryAmount = null
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // The in-memory value is already cleared.
  }
  emitActivationBonus()
}

/** Read and clear. The home screen shows the note once per activation. */
export function takeActivationBonus(): number | null {
  const amount = readActivationBonus()
  dismissActivationBonus()
  return amount
}

/** @internal test-only — drops the in-memory amount between cases. */
export function resetActivationBonusForTests(): void {
  memoryAmount = null
}
