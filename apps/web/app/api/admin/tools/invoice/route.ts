import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateQuery } from '@/lib/validation/middleware'
import { invoiceLookupQuerySchema } from '@/lib/validation/schemas'
import { lookupInvoice } from '@/lib/invoice-lookup'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/admin/tools/invoice?invoice= — decode a bolt11 and resolve the
 * local rows tied to it (owner, wallet, preimage) or, for an invoice not
 * minted here, the payee node's public Amboss data.
 */
export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.USERS_READ)
  await rateLimit(request, RateLimitPresets.public)
  const { invoice } = validateQuery(request.url, invoiceLookupQuerySchema)
  return NextResponse.json(await lookupInvoice(invoice))
})
