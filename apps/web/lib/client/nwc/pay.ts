'use client'

import { getNwcClient } from './nwc-client'
import type { ParsedDestination } from './parse-destination'
import { requestLnurlInvoice } from '@/lib/client/lnurl-invoice'

export interface PayResult {
  preimage: string
  feesPaidSats: number
}

/**
 * Pays an already-decoded bolt11 invoice through the connected NWC wallet.
 * The caller is responsible for confirming the amount with the user before
 * calling this — `pay_invoice` is irrevocable once broadcast.
 *
 * Note: this resolves only when the wallet returns the `pay_invoice` response,
 * which some wallets (LNCurl/Alby) deliver slowly or drop. Callers that need
 * resilient "did it settle?" UX should ALSO watch the balance out-of-band — see
 * `WalletActions`, which races this against the server balance endpoint.
 */
export async function payInvoice(
  nwcString: string,
  bolt11: string,
  amountSats?: number,
): Promise<PayResult> {
  const client = await getNwcClient(nwcString)
  const res = await client.payInvoice({
    invoice: bolt11,
    amount: amountSats !== undefined ? amountSats * 1000 : undefined,
  })
  return {
    preimage: res.preimage,
    feesPaidSats: Math.floor((res.fees_paid ?? 0) / 1000),
  }
}

/**
 * Resolves a LUD-16 / LNURL-pay destination to a bolt11 invoice for the
 * requested amount, then pays it. Returns the preimage on success.
 */
export async function payLnurl(
  nwcString: string,
  destination: { lnurlpUrl: string; address?: string | null },
  amountSats: number,
  comment?: string,
): Promise<PayResult> {
  const pr = await requestLnurlInvoice(destination.lnurlpUrl, amountSats, comment)
  return payInvoice(nwcString, pr)
}

/**
 * Dispatches based on destination kind. Throws for `npub` (not yet wired).
 */
export async function pay(
  nwcString: string,
  destination: ParsedDestination,
  amountSats: number | null,
  comment?: string,
): Promise<PayResult> {
  if (destination.kind === 'invoice') {
    if (destination.amountSats === null && (amountSats === null || amountSats <= 0)) {
      throw new Error('Enter an amount for this zero-amount invoice')
    }
    const amt = destination.amountSats ?? amountSats ?? 0
    return payInvoice(nwcString, destination.bolt11, destination.amountSats ? undefined : amt)
  }

  if (destination.kind === 'lnurl-pay') {
    if (amountSats === null || amountSats <= 0) throw new Error('Enter an amount')
    return payLnurl(
      nwcString,
      { lnurlpUrl: destination.lnurlpUrl, address: 'address' in destination ? destination.address : null },
      amountSats,
      comment,
    )
  }

  throw new Error('Zaps to npubs are not supported yet')
}
