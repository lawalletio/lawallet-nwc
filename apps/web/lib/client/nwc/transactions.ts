'use client'

import { getNwcClient } from './nwc-client'

export interface NwcTransaction {
  type: 'incoming' | 'outgoing'
  amountSats: number
  feesPaidSats: number
  description: string
  paymentHash: string
  preimage: string | null
  settledAt: number | null
  createdAt: number
}

export interface ListTransactionsOpts {
  limit?: number
  /** Unix seconds; include only transactions created before this. */
  until?: number
  /** Unix seconds; include only transactions created after this. */
  from?: number
  type?: 'incoming' | 'outgoing'
}

interface RawTransaction {
  type: 'incoming' | 'outgoing'
  amount: number
  fees_paid?: number | null
  description?: string | null
  payment_hash: string
  preimage?: string | null
  settled_at?: number | null
  created_at: number
}

function normalize(raw: RawTransaction): NwcTransaction {
  return {
    type: raw.type,
    amountSats: Math.floor(raw.amount / 1000),
    feesPaidSats: Math.floor((raw.fees_paid ?? 0) / 1000),
    description: raw.description ?? '',
    paymentHash: raw.payment_hash,
    preimage: raw.preimage ?? null,
    settledAt: raw.settled_at ? raw.settled_at * 1000 : null,
    createdAt: raw.created_at * 1000,
  }
}

/**
 * Calls NWC `list_transactions`. Returns an empty array if the wallet
 * doesn't support the method (feature-detect via `getInfo().methods` before
 * surfacing the activity feed if you need a cleaner UX).
 */
export async function listTransactions(
  nwcString: string,
  opts: ListTransactionsOpts = {},
): Promise<NwcTransaction[]> {
  const client = await getNwcClient(nwcString)
  const res = (await client.listTransactions({
    limit: opts.limit ?? 20,
    until: opts.until,
    from: opts.from,
    type: opts.type,
  })) as { transactions?: RawTransaction[] }
  const list = res.transactions ?? []
  return list.map(normalize)
}
