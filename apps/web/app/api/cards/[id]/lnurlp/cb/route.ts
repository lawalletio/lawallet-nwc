import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@/lib/generated/prisma'
import type { LUD06CallbackError, LUD06CallbackSuccess } from '@/types/lnurl'
import { withErrorHandling } from '@/types/server/error-handler'
import {
  InternalServerError,
  NotFoundError,
  ServiceUnavailableError
} from '@/types/server/errors'
import {
  LUD12_MAX_COMMENT_LENGTH,
  idParam,
  lud16CallbackQuerySchema
} from '@/lib/validation/schemas'
import { validateParams, validateQuery } from '@/lib/validation/middleware'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { extractExpiry, extractPaymentHash } from '@/lib/invoice-utils'
import { DriverError, driverForWallet } from '@/lib/wallet/drivers'
import { eventBus } from '@/lib/events/event-bus'
import {
  CARD_LNURLP_MAX_SENDABLE_MSATS,
  CARD_LNURLP_MIN_SENDABLE_MSATS,
  decideCardReceive,
  loadCardForLnurlPay
} from '@/lib/card-payments/lnurl-pay'
import {
  PUBLIC_READ_CORS_HEADERS,
  publicReadOptions,
  withPublicReadCors
} from '@/lib/public-cors'

/**
 * LUD-06 callback for a BoltCard top-up. Mints a BOLT11 invoice on the card's
 * RemoteWallet via the driver (`make_invoice` for NWC) and records it as
 * `CARD_TOPUP` so settlement credits that wallet, not the owner's LUD-16.
 *
 * https://github.com/lnurl/luds/blob/luds/06.md
 */
function lnurlError(reason: string): NextResponse {
  return NextResponse.json({
    status: 'ERROR',
    reason
  } satisfies LUD06CallbackError)
}

export const OPTIONS = publicReadOptions

export const GET = withErrorHandling(
  withPublicReadCors(
    async (
      req: NextRequest,
      { params }: { params: Promise<{ id: string }> }
    ) => {
      await rateLimit(req, RateLimitPresets.lud16)

      const { id: cardId } = validateParams(await params, idParam)
      const { amount, comment } = validateQuery(
        req.url,
        lud16CallbackQuerySchema
      )
      const sanitizedComment =
        comment
          ?.trim()
          .replace(/[\x00-\x1f\x7f]/g, '')
          .slice(0, LUD12_MAX_COMMENT_LENGTH) || undefined

      const card = await loadCardForLnurlPay(cardId)
      if (!card) throw new NotFoundError('Card not found')

      let decision
      try {
        decision = decideCardReceive(card)
      } catch (err) {
        if (err instanceof DriverError) {
          logger.error(
            { cardId, err: String(err) },
            'Card LNURL-pay callback wallet route resolution failed'
          )
          throw new ServiceUnavailableError('Wallet is currently unavailable')
        }
        throw err
      }
      if (!decision.ok) {
        logger.info(
          { cardId, reason: decision.reason },
          'Card LNURL-pay callback rejected'
        )
        return lnurlError(decision.reason)
      }

      const amountMsats = Number(amount)
      if (!/^[1-9]\d*$/.test(amount) || !Number.isSafeInteger(amountMsats)) {
        return lnurlError('Invalid payment amount')
      }
      if (
        amountMsats < CARD_LNURLP_MIN_SENDABLE_MSATS ||
        amountMsats > CARD_LNURLP_MAX_SENDABLE_MSATS
      ) {
        return lnurlError('Amount is outside the allowed range')
      }

      const baseDescription = 'BoltCard top-up'
      const description = sanitizedComment
        ? `${baseDescription}: ${sanitizedComment}`
        : baseDescription

      const route = decision.route
      let made
      try {
        const { driver, config } = driverForWallet({
          id: route.walletId ?? undefined,
          type: route.type,
          config: route.config
        })
        made = await driver.makeInvoice(config, {
          amountMsats,
          description
        })
      } catch (err) {
        if (err instanceof DriverError) {
          logger.error(
            { cardId, walletType: route.type, err: String(err) },
            'Card LNURL-pay invoice mint failed'
          )
          throw new ServiceUnavailableError('Wallet is currently unavailable')
        }
        throw err
      }

      const pr = made.bolt11
      if (!pr) throw new InternalServerError('Failed to generate invoice')

      if (made.amountMsats !== undefined && made.amountMsats !== amountMsats) {
        throw new ServiceUnavailableError(
          'Wallet returned an invoice with the wrong amount'
        )
      }

      const paymentHash = made.paymentHash || extractPaymentHash(pr)
      if (!paymentHash) {
        logger.error({ cardId }, 'Failed to extract payment hash from bolt11')
        throw new InternalServerError('Invalid invoice returned from wallet')
      }

      const amountSats = Math.floor(amountMsats / 1000)
      const metadata = {
        cardId,
        ...(sanitizedComment ? { comment: sanitizedComment } : {})
      } as unknown as Prisma.InputJsonValue

      const invoice = await prisma.invoice.upsert({
        where: { paymentHash },
        create: {
          bolt11: pr,
          paymentHash,
          amountSats,
          amountMsats: BigInt(amountMsats),
          description,
          purpose: 'CARD_TOPUP',
          status: 'PENDING',
          userId: card.userId ?? undefined,
          remoteWalletId: route.walletId ?? undefined,
          expiresAt: extractExpiry(pr),
          metadata
        },
        update: {
          bolt11: pr,
          description,
          amountMsats: BigInt(amountMsats),
          remoteWalletId: route.walletId ?? undefined,
          expiresAt: extractExpiry(pr),
          metadata
        }
      })

      logger.info(
        {
          invoiceId: invoice.id,
          cardId,
          paymentHash,
          amountSats,
          remoteWalletId: route.walletId ?? null,
          hasComment: Boolean(sanitizedComment)
        },
        'Card LNURL-pay invoice created'
      )

      eventBus.emit({ type: 'invoices:updated', timestamp: Date.now() })

      const response: LUD06CallbackSuccess = { pr, routes: [] }
      return NextResponse.json(response)
    }
  ),
  { headers: PUBLIC_READ_CORS_HEADERS }
)
