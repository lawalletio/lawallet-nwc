import type { SwapStatus } from '@/lib/generated/prisma'

/** Lightning → ARS off-ramp, implemented by Bull Bitcoin and Wapu. */
export interface SwapProvider {
  quote(amountArs: number): Promise<{
    /** Sats the user would pay for `amountArs`. */
    sats: number
    arsPerBtc: number
    /** Provider minimum in ARS, when known. */
    minArs: number | null
  }>
  createSell(input: {
    amountArs: number
    destination: string
    holderName?: string
  }): Promise<{
    externalId: string
    bolt11: string
    amountSats: number
    providerStatus: string
    expiresAt: Date | null
  }>
  status(swap: {
    externalId: string
    amountArs: number
    createdAt: Date
  }): Promise<{
    status: SwapStatus
    providerStatus: string
    /** Set when the provider id changes (Wapu: deposit → fiat transfer). */
    externalId?: string
    receiptUrl?: string | null
    /** The provider has the sats (even if we never got the preimage). */
    paid?: boolean
    /** The provider's own order deadline, when it states one. */
    expiresAt?: Date | null
  }>
  /** Credential/connectivity check for the admin Test button. */
  test(): Promise<string>
}

/** Map a raw provider status ("Completed"/"Canceled"/…) to ours. */
export function normalizeSwapStatus(raw?: string | null): SwapStatus {
  const s = (raw ?? '').toLowerCase()
  if (/complet|execut|paid|success|done|acredit/.test(s)) return 'COMPLETED'
  if (/expir/.test(s)) return 'EXPIRED'
  if (/cancel|fail|reject|error|reversed/.test(s)) return 'FAILED'
  return 'PENDING'
}

/** Provider amounts come in BTC or sats; always return sats. */
export function toSats(amount: number, currency: string): number {
  return /btc/i.test(currency)
    ? Math.round(amount * 100_000_000)
    : Math.round(amount)
}
