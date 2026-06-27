import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { LUD03Request } from '@/types/lnurl'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { idParam, scanCardQuerySchema } from '@/lib/validation/schemas'
import { validateParams, validateQuery } from '@/lib/validation/middleware'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { resolveApiUrl } from '@/lib/public-url'
import { resolveCardWallet } from '@/lib/wallet/resolve-payment-route'
import { buildCardInfo } from '@/lib/card-info'

// LUD-03 withdraw bounds (millisatoshis) for a payable card.
const MIN_WITHDRAWABLE = 1
const MAX_WITHDRAWABLE = 10000000

export const OPTIONS = withErrorHandling(async (_req: NextRequest) => {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, LAWALLET_ACTION, x-request-action'
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

  // The LNURL path needs the SUN params; validate them up front so a malformed
  // tap fails fast (the `info` request carries no `p`/`c`).
  const sun = isInfo ? null : validateQuery(req.url, scanCardQuerySchema)

  // Find card by id, including its design + owner (for the `info` response) and
  // the wallet routing inputs (so the normal scan can tell whether it can pay).
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: {
      design: { select: { description: true, imageUrl: true } },
      user: {
        include: {
          remoteWallets: {
            where: { isDefault: true },
            select: { type: true, config: true, status: true },
            take: 1
          },
          lightningAddresses: {
            where: { isPrimary: true },
            take: 1,
            select: { username: true }
          }
        }
      },
      remoteWallet: { select: { type: true, config: true, status: true } }
    }
  })

  if (!card) {
    throw new NotFoundError('Card not found')
  }

  // `x-request-action: info` → return the card's public status JSON instead of
  // the LNURL withdraw request. Non-sensitive only (no keys/OTC/SUN params).
  if (isInfo) {
    return NextResponse.json(buildCardInfo(card), {
      headers: { 'Access-Control-Allow-Origin': '*' }
    })
  }

  // Regular first LNURL request — `sun` is the validated `p`/`c`.
  const { p, c } = sun!
  // The callback is hit directly by the wallet/device, so it must be prefixed
  // with this instance's API URL (the `endpoint` setting / request host) — NOT
  // the lightning-address `domain`, which need not serve the API.
  const url = await resolveApiUrl(req)

  // An unconfigured card (no usable wallet) advertises a 0–0 withdraw range so
  // a wallet sees up front that nothing can be withdrawn, rather than only
  // finding out when the callback rejects the payment.
  const configured =
    resolveCardWallet({
      remoteWallet: card.remoteWallet ?? null,
      defaultRemoteWallet: card.user?.remoteWallets?.[0] ?? null
    }).kind === 'wallet'

  const response = {
    tag: 'withdrawRequest',
    k1: 'k',
    minWithdrawable: configured ? MIN_WITHDRAWABLE : 0,
    maxWithdrawable: configured ? MAX_WITHDRAWABLE : 0,
    defaultDescription: 'Boltcard + NWC',
    callback: `${url}/api/cards/${cardId}/scan/cb?p=${p}&c=${c}`
  } as LUD03Request

  return NextResponse.json(response, {
    headers: { 'Access-Control-Allow-Origin': '*' }
  })
  },
  { headers: { 'Access-Control-Allow-Origin': '*' } }
)
