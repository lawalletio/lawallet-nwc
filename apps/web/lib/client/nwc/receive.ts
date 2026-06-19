'use client'

import { getNwcClient } from './nwc-client'

export interface MakeInvoiceResult {
  bolt11: string
  paymentHash: string
  amountSats: number
  description: string
  expiresAt: number | null
}

/**
 * Mints a bolt11 invoice via NWC `make_invoice`. Wallets that don't
 * advertise `make_invoice` in `get_info().methods` will reject — feature
 * detect before offering the flow in the UI.
 */
export async function makeInvoice(
  nwcString: string,
  amountSats: number,
  description = '',
): Promise<MakeInvoiceResult> {
  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    throw new Error('Enter an amount')
  }
  const client = await getNwcClient(nwcString)
  const res = await client.makeInvoice({
    amount: amountSats * 1000,
    description,
  })
  const expiresAt = typeof res.expires_at === 'number' ? res.expires_at * 1000 : null
  return {
    bolt11: res.invoice,
    paymentHash: res.payment_hash,
    amountSats: Math.floor(res.amount / 1000),
    description: res.description ?? description,
    expiresAt,
  }
}

export interface InvoiceStatus {
  /** True once the wallet reports the invoice settled. */
  settled: boolean
  /** Settled amount in sats (0 until paid). */
  amountSats: number
}

/**
 * Polls NWC `lookup_invoice` by payment hash to detect settlement, so the
 * receive flow can flip to a "paid" state in real time without the user
 * refreshing. Returns `settled: false` (rather than throwing) when the wallet
 * hasn't seen the payment yet; genuine relay/transport errors still throw so
 * callers can decide whether to keep polling.
 */
export async function lookupInvoice(
  nwcString: string,
  paymentHash: string,
): Promise<InvoiceStatus> {
  const client = await getNwcClient(nwcString)
  const res = (await client.lookupInvoice({ payment_hash: paymentHash })) as {
    settled_at?: number | null
    amount?: number
  }
  return {
    settled: res.settled_at != null,
    amountSats: Math.floor((res.amount ?? 0) / 1000),
  }
}
