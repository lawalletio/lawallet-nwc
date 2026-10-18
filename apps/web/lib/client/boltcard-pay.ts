import {
  LnurlError,
  resolveLnurl,
  submitLnurlWithdraw
} from '@/lib/client/lnurl-scan'

export type BoltcardPayErrorCode =
  | 'noInvoice'
  | 'notBoltcard'
  | 'aboveMax'
  | 'belowMin'
  | 'rejected'
  | 'unreachable'
  | 'cannotPay'

export class BoltcardPayError extends Error {
  constructor(
    message: string,
    /** Unset when wrapping an LnurlError — its code (if any) is on `cause`. */
    readonly code?: BoltcardPayErrorCode,
    /** Card limit and invoice amount, for `aboveMax` / `belowMin`. */
    readonly limits?: { limitSats: number; amountSats: number },
    options?: { cause?: unknown }
  ) {
    super(message, options)
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
    throw new BoltcardPayError('There is no invoice to charge.', 'noInvoice')
  }

  let resolved: Awaited<ReturnType<typeof resolveLnurl>>
  try {
    resolved = await resolveLnurl(cardUrl)
  } catch (err) {
    throw mapResolveError(err)
  }

  if (!resolved || resolved.kind !== 'withdraw') {
    throw new BoltcardPayError('This tag is not a BoltCard.', 'notBoltcard')
  }

  const { minWithdrawableSats, maxWithdrawableSats, callback, k1 } =
    resolved.params
  if (amountSats > maxWithdrawableSats) {
    throw new BoltcardPayError(
      `This card can pay up to ${maxWithdrawableSats.toLocaleString()} sats. This invoice is ${amountSats.toLocaleString()} sats.`,
      'aboveMax',
      { limitSats: maxWithdrawableSats, amountSats }
    )
  }
  if (amountSats < minWithdrawableSats) {
    throw new BoltcardPayError(
      `This card's minimum is ${minWithdrawableSats.toLocaleString()} sats. This invoice is ${amountSats.toLocaleString()} sats.`,
      'belowMin',
      { limitSats: minWithdrawableSats, amountSats }
    )
  }

  try {
    await submitLnurlWithdraw(callback, k1, bolt11)
  } catch (err) {
    if (err instanceof LnurlError) {
      throw new BoltcardPayError(err.message, undefined, undefined, {
        cause: err
      })
    }
    throw new BoltcardPayError('The card payment was rejected.', 'rejected')
  }
}

function mapResolveError(err: unknown): BoltcardPayError {
  if (!(err instanceof LnurlError)) {
    return new BoltcardPayError('Could not reach the card.', 'unreachable')
  }
  if (err.code === 'noAmount' || err.code === 'belowOneSat') {
    return new BoltcardPayError('This card cannot pay right now.', 'cannotPay')
  }
  return new BoltcardPayError(err.message, undefined, undefined, {
    cause: err
  })
}
