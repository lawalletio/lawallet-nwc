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
