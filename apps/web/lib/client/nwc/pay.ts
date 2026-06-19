'use client'

import { decode } from 'light-bolt11-decoder'
import { getNwcClient } from './nwc-client'
import type { ParsedDestination } from './parse-destination'

export interface PayResult {
  preimage: string
  feesPaidSats: number
}

/** Pull the payment hash out of a bolt11 so we can verify settlement. */
function paymentHashFromBolt11(bolt11: string): string | null {
  try {
    const section = decode(bolt11).sections.find(s => s.name === 'payment_hash')
    return section && typeof section.value === 'string' ? section.value : null
  } catch {
    return null
  }
}

const SETTLE_POLL_MS = 2500
const SETTLE_MAX_MS = 120_000

/**
 * Spendable balance in msats, or null on error/timeout. Bounded so a hung
 * relay call can't stall the settlement check.
 */
async function balanceMsats(
  client: Awaited<ReturnType<typeof getNwcClient>>,
  timeoutMs = 5000,
): Promise<number | null> {
  try {
    const res = await Promise.race([
      client.getBalance(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), timeoutMs)),
    ])
    return res && typeof res.balance === 'number' ? res.balance : null
  } catch {
    return null
  }
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

  // Snapshot the balance BEFORE paying so we can detect settlement by watching
  // it fall — the universal signal, and exactly what the user sees. NWC
  // `pay_invoice` responses can arrive late or get dropped, and
  // `lookup_invoice` doesn't reliably cover *outgoing* payments on every
  // wallet, so we never depend on either alone (which left the UI stuck
  // "sending" even though the payment had settled).
  const baseline = await balanceMsats(client)

  const payPromise: Promise<PayResult> = client
    .payInvoice({
      invoice: bolt11,
      amount: amountSats !== undefined ? amountSats * 1000 : undefined,
    })
    .then(res => ({
      preimage: res.preimage ?? '',
      feesPaidSats: Math.floor((res.fees_paid ?? 0) / 1000),
    }))

  const paymentHash = paymentHashFromBolt11(bolt11)

  // Nothing to verify against — rely on the pay response alone.
  if (baseline == null && !paymentHash) return payPromise

  return new Promise<PayResult>((resolve, reject) => {
    let finished = false
    let poll: ReturnType<typeof setInterval> | null = null
    let cap: ReturnType<typeof setTimeout> | null = null
    const stop = () => {
      if (poll) clearInterval(poll)
      if (cap) clearTimeout(cap)
      poll = null
      cap = null
    }
    const succeed = (r: PayResult) => {
      if (finished) return
      finished = true
      stop()
      resolve(r)
    }
    const fail = (e: unknown) => {
      if (finished) return
      finished = true
      stop()
      reject(e)
    }

    const checkSettled = async (): Promise<PayResult | null> => {
      // (a) lookup_invoice — when the wallet supports it for this tx it also
      //     returns the preimage.
      if (paymentHash) {
        try {
          const tx = (await client.lookupInvoice({ payment_hash: paymentHash })) as {
            settled_at?: number | null
            preimage?: string | null
            fees_paid?: number | null
          }
          if (tx?.settled_at != null) {
            return {
              preimage: tx.preimage ?? '',
              feesPaidSats: Math.floor((tx.fees_paid ?? 0) / 1000),
            }
          }
        } catch {
          // not supported for outgoing / transient — fall through to balance.
        }
      }
      // (b) balance fell by at least 1 sat → the payment left the wallet.
      if (baseline != null) {
        const now = await balanceMsats(client)
        if (now != null && baseline - now >= 1000) {
          return { preimage: '', feesPaidSats: 0 }
        }
      }
      return null
    }

    payPromise.then(
      r => succeed(r),
      async err => {
        // The pay call errored or timed out — do a final settlement check
        // before surfacing the failure (covers "settled but response lost").
        const settled = await checkSettled()
        if (settled) succeed(settled)
        else fail(err)
      },
    )

    poll = setInterval(async () => {
      const settled = await checkSettled()
      if (settled) succeed(settled)
    }, SETTLE_POLL_MS)

    cap = setTimeout(
      () => fail(new Error('Payment status unknown — check your wallet before retrying')),
      SETTLE_MAX_MS,
    )
  })
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
