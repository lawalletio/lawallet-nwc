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

export async function requestLnurlInvoice(
  lnurlpUrl: string,
  amountSats: number,
  comment?: string,
): Promise<string> {
  if (!Number.isFinite(amountSats) || amountSats <= 0) {
    throw new Error('Enter an amount')
  }

  const metaRes = await fetch(lnurlpUrl, { headers: { accept: 'application/json' } })
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

  return cbJson.pr
}
