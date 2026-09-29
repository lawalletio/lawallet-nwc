'use client'

/**
 * Resolve a LUD-16 / LNURL-pay endpoint to a bolt11 invoice for a given amount,
 * WITHOUT paying it. Split out from the wallet-bound `payLnurl` so callers that
 * only need the invoice (e.g. the card emulator, where the *card's* wallet pays
 * the returned `pr` via `/scan/cb`) don't pull in the NWC client.
 */

interface LnurlPayMetadata {
  callback: string
  minSendable: number
  maxSendable: number
  commentAllowed?: number
  metadata?: string
  tag: string
}

interface LnurlPayCallbackResponse {
  pr?: string
  status?: string
  reason?: string
}

export interface LnurlInvoice {
  paymentRequest: string
  /**
   * LUD-12 comment actually attached to the callback. Null when the payer
   * left none, the recipient does not accept comments, or the recipient
   * rejected the comment and the invoice was requested again without it.
   */
  comment: string | null
}

/**
 * Comment the callback will accept. LUD-12: omit the param entirely when
 * `commentAllowed` is missing or 0 — sending one anyway is a spec violation
 * that many providers answer with HTTP 400.
 */
function commentWithinBudget(
  comment: string | undefined,
  commentAllowed: number | undefined
): string | null {
  const trimmed = comment?.trim()
  if (!trimmed) return null
  if (!Number.isFinite(commentAllowed) || (commentAllowed ?? 0) <= 0) {
    return null
  }
  return trimmed.slice(0, commentAllowed) || null
}

async function fetchCallbackInvoice(url: string): Promise<string> {
  const cbRes = await fetch(url, {
    headers: { accept: 'application/json' }
  })
  if (!cbRes.ok) {
    throw new Error(`Recipient callback returned ${cbRes.status}`)
  }
  const cbJson = (await cbRes.json()) as LnurlPayCallbackResponse
  if (cbJson.status === 'ERROR' || !cbJson.pr) {
    throw new Error(cbJson.reason || 'Recipient refused the invoice request')
  }
  return cbJson.pr
}

export async function requestLnurlInvoice(
  lnurlpUrl: string,
  amountSats: number,
  comment?: string
): Promise<LnurlInvoice> {
  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    throw new Error('Enter an amount')
  }

  const metaRes = await fetch(lnurlpUrl, {
    headers: { accept: 'application/json' }
  })
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
  let sentComment = commentWithinBudget(comment, meta.commentAllowed)
  if (sentComment) cbUrl.searchParams.set('comment', sentComment)

  try {
    const paymentRequest = await fetchCallbackInvoice(cbUrl.toString())
    return { paymentRequest, comment: sentComment }
  } catch (err) {
    // A recipient that advertised a comment budget can still refuse the
    // note. Drop it and mint again so the payment itself can proceed.
    if (!sentComment) throw err
    cbUrl.searchParams.delete('comment')
    sentComment = null
    const paymentRequest = await fetchCallbackInvoice(cbUrl.toString())
    return { paymentRequest, comment: null }
  }
}
