import {
  LnurlError,
  resolveLnurl,
  submitLnurlWithdraw
} from '@/lib/client/lnurl-scan'

export class BoltcardPayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BoltcardPayError'
  }
}

/**
 * Charge the invoice already on screen from a BoltCard LNURL-withdraw link.
 *
 * Same sequence as lawalletio/mobile-pos `processRegularPayment`: resolve the
 * card URL (lnurlw → https), then GET the callback with `k1` and `pr` set to
 * the bolt11 the payer is looking at. This never mints a second invoice.
 */
export async function payDisplayedInvoiceFromCard(input: {
  cardUrl: string
  bolt11: string
  amountSats: number
}): Promise<void> {
  const { cardUrl, bolt11, amountSats } = input
  if (!bolt11 || amountSats <= 0) {
    throw new BoltcardPayError('There is no invoice to charge.')
  }

  let resolved: Awaited<ReturnType<typeof resolveLnurl>>
  try {
    resolved = await resolveLnurl(cardUrl)
  } catch (err) {
    throw new BoltcardPayError(mapResolveError(err))
  }

  if (!resolved || resolved.kind !== 'withdraw') {
    throw new BoltcardPayError('This tag is not a BoltCard.')
  }

  const { minWithdrawableSats, maxWithdrawableSats, callback, k1 } =
    resolved.params
  if (amountSats > maxWithdrawableSats) {
    throw new BoltcardPayError(
      `This card can pay up to ${maxWithdrawableSats.toLocaleString()} sats. This invoice is ${amountSats.toLocaleString()} sats.`
    )
  }
  if (amountSats < minWithdrawableSats) {
    throw new BoltcardPayError(
      `This card's minimum is ${minWithdrawableSats.toLocaleString()} sats. This invoice is ${amountSats.toLocaleString()} sats.`
    )
  }

  try {
    await submitLnurlWithdraw(callback, k1, bolt11)
  } catch (err) {
    if (err instanceof LnurlError) throw new BoltcardPayError(err.message)
    throw new BoltcardPayError('The card payment was rejected.')
  }
}

function mapResolveError(err: unknown): string {
  if (!(err instanceof LnurlError)) return 'Could not reach the card.'
  if (/no withdrawable amount/i.test(err.message)) {
    return 'This card cannot pay right now.'
  }
  if (/below 1 sat/i.test(err.message)) {
    return 'This card cannot pay right now.'
  }
  return err.message
}
