import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticate } from '@/lib/auth/unified-auth'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody } from '@/lib/validation/middleware'
import { probeAliasAddressSchema } from '@/lib/validation/schemas'
import { probeLightningAddressCapabilities } from '@/lib/lnurl-probe'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/wallet/addresses/alias-probe
 *
 * Authenticated preflight for ALIAS mode. It runs server-side so providers
 * with incomplete browser CORS headers can still be checked reliably.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await checkRequestLimits(request, 'json')
  await authenticate(request)

  const { address } = await validateBody(request, probeAliasAddressSchema)
  const result = await probeLightningAddressCapabilities(address)

  return NextResponse.json(result)
})
