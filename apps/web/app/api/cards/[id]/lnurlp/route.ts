import { NextRequest, NextResponse } from 'next/server'
import type { LUD06Response } from '@/types/lnurl'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ServiceUnavailableError } from '@/types/server/errors'
import { LUD12_MAX_COMMENT_LENGTH, idParam } from '@/lib/validation/schemas'
import { validateParams } from '@/lib/validation/middleware'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { resolveApiUrl } from '@/lib/public-url'
import { logger } from '@/lib/logger'
import { DriverError } from '@/lib/wallet/drivers/errors'
import {
  CARD_LNURLP_MAX_SENDABLE_MSATS,
  CARD_LNURLP_MIN_SENDABLE_MSATS,
  cardLnurlPayCallbackUrl,
  cardLnurlPayMetadata,
  decideCardReceive,
  loadCardForLnurlPay
} from '@/lib/card-payments/lnurl-pay'
import {
  PUBLIC_READ_CORS_HEADERS,
  publicReadOptions,
  withPublicReadCors
} from '@/lib/public-cors'

/**
 * LUD-06 payRequest for a BoltCard top-up (LUD-19 `payLink` target).
 *
 * Public, like LUD-16 metadata: the wallet stored the raw `lnurlp://` URL from
 * the card's withdraw response and fetches it later, without a fresh NFC tap.
 * SUN `p`/`c` stay on the spend path only — minting an invoice does not move
 * funds out of the wallet.
 *
 * https://github.com/lnurl/luds/blob/luds/06.md
 * https://github.com/lnurl/luds/blob/luds/19.md
 */
export const OPTIONS = publicReadOptions

export const GET = withErrorHandling(
  withPublicReadCors(
    async (
      req: NextRequest,
      { params }: { params: Promise<{ id: string }> }
    ) => {
      await rateLimit(req, RateLimitPresets.lud16)

      const { id: cardId } = validateParams(await params, idParam)
      const [card, apiUrl] = await Promise.all([
        loadCardForLnurlPay(cardId),
        resolveApiUrl(req)
      ])
      if (!card) throw new NotFoundError('Card not found')

      let decision
      try {
        decision = decideCardReceive(card)
      } catch (err) {
        if (err instanceof DriverError) {
          logger.error(
            { cardId, err: String(err) },
            'Card LNURL-pay wallet route resolution failed'
          )
          throw new ServiceUnavailableError('Wallet is currently unavailable')
        }
        throw err
      }

      if (!decision.ok) {
        logger.info(
          { cardId, reason: decision.reason },
          'Card LNURL-pay lookup rejected'
        )
        return NextResponse.json({
          status: 'ERROR',
          reason: decision.reason
        })
      }

      const response: LUD06Response = {
        tag: 'payRequest',
        callback: cardLnurlPayCallbackUrl(apiUrl, cardId),
        minSendable: CARD_LNURLP_MIN_SENDABLE_MSATS,
        maxSendable: CARD_LNURLP_MAX_SENDABLE_MSATS,
        metadata: cardLnurlPayMetadata(),
        commentAllowed: LUD12_MAX_COMMENT_LENGTH
      }

      logger.info({ cardId }, 'Card LNURL-pay request')
      return NextResponse.json(response)
    }
  ),
  { headers: PUBLIC_READ_CORS_HEADERS }
)
