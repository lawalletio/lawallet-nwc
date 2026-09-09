import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithRole } from '@/lib/auth/unified-auth'
import { Role } from '@/lib/auth/permissions'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody } from '@/lib/validation/middleware'
import { verifyAddressProtocolsSchema } from '@/lib/validation/schemas'
import { verifyAddressProtocols } from '@/lib/wallet/verify-address-protocols'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * POST /api/lightning-addresses/verify-protocols
 *
 * ADMIN-only maintenance: re-resolve one lightning address's protocol
 * capabilities. Alias targets are probed over the network and the result is
 * persisted so the admin list stops reporting "unknown" for addresses created
 * before LUD-16 verification existed.
 */
export const POST = withErrorHandling(async (request: Request) => {
  await authenticateWithRole(request, Role.ADMIN)
  await checkRequestLimits(request, 'json')
  const { username } = await validateBody(request, verifyAddressProtocolsSchema)
  const result = await verifyAddressProtocols(username)
  return NextResponse.json(result)
})
