import { Card } from '@/types'
import { LUD03CallbackSuccess } from '@/types/lnurl'
import { User } from '@/types/user'
import { NextRequest, NextResponse } from 'next/server'
import {
  InternalServerError,
  ValidationError
} from '@/types/server/errors'
import { logger } from '@/lib/logger'
import { payActionQuerySchema } from '@/lib/validation/schemas'
import { validateQuery } from '@/lib/validation/middleware'
import { resolveCardWallet, type RemoteWalletRef } from '@/lib/wallet/resolve-payment-route'
import { DriverError, driverForWallet } from '@/lib/wallet/drivers'

/**
 * Card scan "pay" action. The card spends through its bound RemoteWallet
 * (or the owner's default), resolving via the driver registry (#234). Falls
 * back to the legacy `User.nwc` URI for cards that predate RemoteWallet.
 *
 * The `card` is loaded by the scan/cb route with `remoteWallet` + the
 * owner's default `remoteWallets` included.
 */
type CardWithWallet = Card & {
  user?: User & { remoteWallets?: RemoteWalletRef[] }
  remoteWallet?: RemoteWalletRef | null
}

export default async function pay(req: NextRequest, card: CardWithWallet) {
  const { pr } = validateQuery(req.url, payActionQuerySchema)

  const route = resolveCardWallet({
    remoteWallet: card.remoteWallet ?? null,
    defaultRemoteWallet: card.user?.remoteWallets?.[0] ?? null,
    userNwc: card.user?.nwc ?? null,
  })

  if (route.kind !== 'wallet') {
    logger.error({ cardId: card.id }, 'Card has no usable wallet for payment')
    throw new ValidationError('Card is not configured for payments')
  }

  try {
    logger.info({ cardId: card.id, source: route.source }, 'Processing payment request')
    const { driver, config } = driverForWallet({ type: route.type, config: route.config })
    // The scanned `pr` is a fully-amounted bolt11 (the merchant's invoice),
    // so we don't pass an override amount.
    await driver.payInvoice(config, { bolt11: pr })
    logger.info({ cardId: card.id }, 'Payment successful')
  } catch (error) {
    logger.error({ err: error, cardId: card.id }, 'Payment failed')
    // DriverError covers wallet/relay failures + bad config; everything else
    // is unexpected. Both surface as a 500 to the scanning device, but we
    // keep the message generic so we don't leak connection details.
    if (error instanceof DriverError) {
      throw new InternalServerError('Payment processing failed', { cause: error })
    }
    throw new InternalServerError('Payment processing failed', {
      details: error instanceof Error ? error.message : 'Unknown error',
      cause: error
    })
  }

  return NextResponse.json(
    {
      status: 'OK'
    } as LUD03CallbackSuccess,
    {
      headers: {
        'Access-Control-Allow-Origin': '*'
      }
    }
  )
}
