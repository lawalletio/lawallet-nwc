'use client'

import { getNwcClient } from './nwc-client'
import type { ParsedDestination } from './parse-destination'

export interface PayResult {
  preimage: string
  feesPaidSats: number
}

interface LnurlPayMetadata {
  callback: string
  minSendable: number
  maxSendable: number
  commentAllowed?: number
  metadata?: string
  tag: string
}

interface LnurlPayCallbackResponse {
  pr: string
  routes?: unknown
  verify?: string
  status?: string
  reason?: string
}

/**
 * Pays an already-decoded bolt11 invoice through the connected NWC wallet.
 * The caller is responsible for confirming the amount with the user before
 * calling this — `pay_invoice` is irrevocable once broadcast.
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
  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    throw new Error('Enter an amount')
  }

  const metaRes = await fetch(destination.lnurlpUrl, { headers: { accept: 'application/json' } })
  if (!metaRes.ok) {
    throw new Error(`Recipient returned ${metaRes.status}`)
  }
  const meta = (await metaRes.json()) as LnurlPayMetadata
  if (meta.tag !== 'payRequest') {
    throw new Error('Recipient is not a Lightning address')
  }

  const amountMsats = amountSats * 1000
  if (amountMsats < meta.minSendable || amountMsats > meta.maxSendable) {
    const minSats = Math.ceil(meta.minSendable / 1000)
    const maxSats = Math.floor(meta.maxSendable / 1000)
    throw new Error(`Amount must be between ${minSats} and ${maxSats} sats`)
  }

  const cbUrl = new URL(meta.callback)
  cbUrl.searchParams.set('amount', String(amountMsats))
  if (comment && meta.commentAllowed && meta.commentAllowed > 0) {
    cbUrl.searchParams.set('comment', comment.slice(0, meta.commentAllowed))
  }

  const cbRes = await fetch(cbUrl.toString(), { headers: { accept: 'application/json' } })
  if (!cbRes.ok) {
    throw new Error(`Recipient callback returned ${cbRes.status}`)
  }
  const cbJson = (await cbRes.json()) as LnurlPayCallbackResponse
  if (cbJson.status === 'ERROR' || !cbJson.pr) {
    throw new Error(cbJson.reason || 'Recipient refused the invoice request')
  }

  return payInvoice(nwcString, cbJson.pr)
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
