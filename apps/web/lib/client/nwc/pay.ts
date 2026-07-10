'use client'

import { getNwcClient } from './nwc-client'
import {
  parseDestination,
  type ParsedDestination,
} from './parse-destination'
import { requestLnurlInvoice } from '@/lib/client/lnurl-invoice'

export interface PayResult {
  preimage: string
  feesPaidSats: number
}

export interface PaymentQuote {
  paymentRequest: string
  amountSats: number
  payAmountSats?: number
  expiresAt: number | null
  feeSats: number | null
  feeQuoteStatus: 'unavailable'
  feeQuoteMessage: string
}

const NWC_FEE_QUOTE_UNAVAILABLE =
  'NWC returns routing fees only after pay_invoice settles.'

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
 * Prepares the payment request that will be sent to the wallet without
 * broadcasting a payment. NWC has no standard route-fee dry-run; the exact
 * fee is still returned by `pay_invoice` after settlement.
 */
export async function quotePayment(
  destination: ParsedDestination,
  amountSats: number | null,
  comment?: string,
): Promise<PaymentQuote> {
  if (destination.kind === 'invoice') {
    if (destination.amountSats === null && (amountSats === null || amountSats <= 0)) {
      throw new Error('Enter an amount for this zero-amount invoice')
    }
    const amount = destination.amountSats ?? amountSats ?? 0
    return {
      paymentRequest: destination.bolt11,
      amountSats: amount,
      payAmountSats: destination.amountSats === null ? amount : undefined,
      expiresAt: destination.expiresAt,
      feeSats: null,
      feeQuoteStatus: 'unavailable',
      feeQuoteMessage: NWC_FEE_QUOTE_UNAVAILABLE,
    }
  }

  if (destination.kind === 'lnurl-pay') {
    if (amountSats === null || amountSats <= 0) throw new Error('Enter an amount')
    const paymentRequest = await requestLnurlInvoice(
      destination.lnurlpUrl,
      amountSats,
      comment,
    )
    const invoice = parseDestination(paymentRequest)
    const invoiceAmount =
      invoice.kind === 'invoice' ? invoice.amountSats ?? amountSats : amountSats
    const expiresAt = invoice.kind === 'invoice' ? invoice.expiresAt : null

    return {
      paymentRequest,
      amountSats: invoiceAmount,
      expiresAt,
      feeSats: null,
      feeQuoteStatus: 'unavailable',
      feeQuoteMessage: NWC_FEE_QUOTE_UNAVAILABLE,
    }
  }

  throw new Error('Zaps to npubs are not supported yet')
}

export async function payQuotedInvoice(
  nwcString: string,
  quote: PaymentQuote,
): Promise<PayResult> {
  return payInvoice(nwcString, quote.paymentRequest, quote.payAmountSats)
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
