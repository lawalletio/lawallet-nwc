import type {
  NwcTransaction,
  NwcTransactionState
} from '@/lib/client/nwc/transactions'

export function isActivityPreviewRequested(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('preview') === '1'
}

export function activityDetailHref(
  paymentHash: string,
  from?: 'home' | 'activity'
): string {
  const path = `/wallet/activity/${encodeURIComponent(paymentHash)}`
  const params = new URLSearchParams()
  if (from === 'home') params.set('from', 'home')
  if (isActivityPreviewRequested()) params.set('preview', '1')
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

export function activityDetailBackHref(from?: string | null): string {
  const path = from === 'home' ? '/wallet' : '/wallet/activity'
  return isActivityPreviewRequested() ? `${path}?preview=1` : path
}

export function activityDetailTitle(
  type: 'incoming' | 'outgoing',
  status: NwcTransactionState
): string {
  if (status === 'pending') return 'Payment pending'
  if (status === 'failed') return 'Payment failed'
  return type === 'incoming' ? 'Payment received' : 'Payment sent'
}

const DEMO_SETTLED_AT = Date.parse('2026-09-19T12:53:00-03:00')

export const DEMO_ACTIVITY_INCOMING: NwcTransaction = {
  type: 'incoming',
  amountSats: 21000,
  feesPaidSats: 0,
  description: 'Coffee',
  paymentHash:
    'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
  preimage: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  settledAt: DEMO_SETTLED_AT,
  createdAt: DEMO_SETTLED_AT,
  state: 'settled'
}

export const DEMO_ACTIVITY_OUTGOING: NwcTransaction = {
  type: 'outgoing',
  amountSats: 21000,
  feesPaidSats: 3,
  description: 'satoshi@example.com',
  paymentHash:
    'b591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
  preimage: 'f3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  settledAt: DEMO_SETTLED_AT - 3_600_000,
  createdAt: DEMO_SETTLED_AT - 3_600_000,
  state: 'settled'
}

export const DEMO_ACTIVITY_PENDING: NwcTransaction = {
  type: 'incoming',
  amountSats: 1000,
  feesPaidSats: 0,
  description: 'Invoice',
  paymentHash:
    'c591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
  preimage: null,
  settledAt: null,
  createdAt: DEMO_SETTLED_AT - 7_200_000,
  state: 'pending'
}

export const DEMO_ACTIVITY_FAILED: NwcTransaction = {
  type: 'outgoing',
  amountSats: 500,
  feesPaidSats: 0,
  description: 'alice@example.com',
  paymentHash:
    'd591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
  preimage: null,
  settledAt: null,
  createdAt: DEMO_SETTLED_AT - 86_400_000,
  state: 'failed'
}

export const DEMO_ACTIVITY: NwcTransaction[] = [
  DEMO_ACTIVITY_INCOMING,
  DEMO_ACTIVITY_OUTGOING,
  DEMO_ACTIVITY_PENDING,
  DEMO_ACTIVITY_FAILED
]

/** Local-only rows so `/wallet?preview=1` and `/wallet/activity?preview=1` can be clicked. */
export function demoActivityTransactions(): NwcTransaction[] {
  return isActivityPreviewRequested() ? DEMO_ACTIVITY : []
}

/** Local-only receipt so a historical detail URL can be opened without NWC. */
export function seedPreviewActivityTx(
  paymentHash: string
): NwcTransaction | null {
  if (!isActivityPreviewRequested()) return null
  const hash = paymentHash.trim()
  return (
    DEMO_ACTIVITY.find(tx => tx.paymentHash === hash) ?? {
      ...DEMO_ACTIVITY_INCOMING,
      paymentHash: hash || DEMO_ACTIVITY_INCOMING.paymentHash
    }
  )
}
