import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { LUD03Request } from '@/types/lnurl'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import {
  CARD_MAX_WITHDRAWABLE_MSATS,
  CARD_MIN_WITHDRAWABLE_MSATS,
  idParam,
  scanCardQuerySchema
} from '@/lib/validation/schemas'
import { validateParams, validateQuery } from '@/lib/validation/middleware'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { resolveApiUrl } from '@/lib/public-url'
import { resolveCardWallet } from '@/lib/wallet/resolve-payment-route'
import { buildCardInfo } from '@/lib/card-info'
import { logger } from '@/lib/logger'
import { derivePrimaryWallet } from '@/lib/wallet/primary-wallet'

export const OPTIONS = withErrorHandling(async (_req: NextRequest) => {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, LAWALLET_ACTION, x-request-action'
    }
  })
})

export const GET = withErrorHandling(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    // Apply rate limiting for card scan (high volume endpoint)
    await rateLimit(req, RateLimitPresets.cardScan)

    const { id: cardId } = validateParams(await params, idParam)
    // Tapping clients ask for card metadata with `x-request-action: info` instead
    // of the regular LNURL flow (which carries the SUN `p`/`c` params).
    const isInfo = req.headers.get('x-request-action') === 'info'

    if (isInfo) {
      // Metadata requests need public presentation fields, but no wallet config.
      const card = await prisma.card.findUnique({
        where: { id: cardId },
        select: {
          id: true,
          title: true,
          kind: true,
          userId: true,
          lastUsedAt: true,
          blockedAt: true,
          disabledAt: true,
          design: { select: { description: true, imageUrl: true } },
          user: {
            select: {
              pubkey: true,
              lightningAddresses: {
                where: { isPrimary: true },
                take: 1,
                select: { username: true }
              }
            }
          }
        }
      })

      if (!card) {
        throw new NotFoundError('Card not found')
      }

      return NextResponse.json(buildCardInfo(card), {
        headers: { 'Access-Control-Allow-Origin': '*' }
      })
    }

    // The LNURL path needs the SUN params; validate them up front so a malformed
    // tap fails fast. Start its independent DB/settings reads together.
    const { p, c } = validateQuery(req.url, scanCardQuerySchema)
    const [card, url] = await Promise.all([
      prisma.card.findUnique({
        where: { id: cardId },
        select: {
          blockedAt: true,
          disabledAt: true,
          remoteWallet: {
            select: { id: true, type: true, config: true, status: true }
          },
          user: {
            select: {
              lightningAddresses: {
                where: { isPrimary: true },
                take: 1,
                select: {
                  mode: true,
                  remoteWalletId: true,
                  remoteWallet: {
                    select: {
                      id: true,
                      type: true,
                      config: true,
                      status: true
                    }
                  }
                }
              }
            }
          }
        }
      }),
      resolveApiUrl(req)
    ])

    if (!card) {
      throw new NotFoundError('Card not found')
    }

    // The callback is hit directly by the wallet/device, so it must be prefixed
    // with this instance's API URL (the `endpoint` setting / request host) — NOT
    // the lightning-address `domain`, which need not serve the API.

    // An unconfigured card (no usable wallet) advertises a 0–0 withdraw range so
    // a wallet sees up front that nothing can be withdrawn, rather than only
    // finding out when the callback rejects the payment.
    const primaryWallet = derivePrimaryWallet(
      card.user?.lightningAddresses?.[0]
    )
    const configured =
      card.blockedAt === null &&
      card.disabledAt === null &&
      resolveCardWallet({
        remoteWallet: card.remoteWallet ?? null,
        defaultRemoteWallet: primaryWallet
      }).kind === 'wallet'

    // Trace the LNURL-withdraw request so the scan → scan/cb sequence is
    // correlatable in logs. `configured=false` means the card has no ACTIVE
    // wallet, so the advertised 0–0 range tells the wallet nothing is payable
    // up front (the eventual cb would 400 with "not configured for payments").
    logger.info({ cardId, configured }, 'Card scan: LNURL-withdraw request')

    const response = {
      tag: 'withdrawRequest',
      k1: 'k',
      minWithdrawable: configured ? CARD_MIN_WITHDRAWABLE_MSATS : 0,
      maxWithdrawable: configured ? CARD_MAX_WITHDRAWABLE_MSATS : 0,
      defaultDescription: 'Boltcard + NWC',
      callback: `${url}/api/cards/${cardId}/scan/cb?p=${p}&c=${c}`
    } as LUD03Request

    return NextResponse.json(response, {
      headers: { 'Access-Control-Allow-Origin': '*' }
    })
  },
  { headers: { 'Access-Control-Allow-Origin': '*' } }
)
