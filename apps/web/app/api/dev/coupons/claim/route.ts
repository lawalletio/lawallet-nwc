import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError, ValidationError } from '@/types/server/errors'
import { assertDevRoutesEnabled } from '@/lib/dev-guard'
import { devPreview } from '@/lib/dev/coupon-service'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * `GET /api/dev/coupons/claim?nonce=` — the claim preview of the in-app dev
 * coupon service. Public and non-consuming, like the real one.
 *
 * Dev-gated: 404 without `ENABLE_DEV_ROUTES=true`, and never in production.
 */
export const GET = withErrorHandling(async (request: NextRequest) => {
  assertDevRoutesEnabled()

  const nonce = request.nextUrl.searchParams.get('nonce')
  if (!nonce) throw new ValidationError('nonce is required')

  const mint = devPreview(nonce)
  if (!mint) throw new NotFoundError('Unknown nonce')

  return NextResponse.json({
    nonce: mint.nonce,
    couponId: mint.couponId,
    name: mint.name,
    description: mint.description,
    image: mint.image,
    coupon: mint.benefit,
    npub: mint.merchantPubkey,
    status: mint.status,
    claimedAt: mint.claimedAt,
    expiresAt: mint.expiresAt
  })
})
