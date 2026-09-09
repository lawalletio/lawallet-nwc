import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { ValidationError } from '@/types/server/errors'
import { assertDevRoutesEnabled } from '@/lib/dev-guard'
import { validateBody } from '@/lib/validation/middleware'
import { z } from 'zod'
import { devRefresh } from '@/lib/dev/coupon-service'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const bodySchema = z.object({ nonce: z.string().trim().min(1) })

/**
 * `POST /api/dev/coupons/refresh` — burn a nonce, mint its replacement.
 *
 * The dev counterpart of the endpoint specified in lacrypta/coupons#2, so the
 * transfer flow can be exercised without an external service. Requires
 * `Idempotency-Key` exactly as the spec does: a retry replays the stored
 * response instead of burning twice.
 */
export const POST = withErrorHandling(async (request: Request) => {
  assertDevRoutesEnabled()

  const key = request.headers.get('idempotency-key')
  if (!key) throw new ValidationError('Idempotency-Key header is required')

  const { nonce } = await validateBody(request, bodySchema)
  const result = devRefresh(nonce, key)

  if (!result.ok) {
    return NextResponse.json(
      { error: result.reason, status: 'refreshed' },
      { status: result.status }
    )
  }
  return NextResponse.json(result.response, {
    status: result.replayed ? 200 : 201
  })
})
