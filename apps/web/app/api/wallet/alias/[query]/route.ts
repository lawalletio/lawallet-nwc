import { NextResponse } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { authenticate } from '@/lib/auth/unified-auth'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateParams } from '@/lib/validation/middleware'
import { aliasQueryParam } from '@/lib/validation/schemas'
import { getIntegrationConfig } from '@/lib/integrations/server'
import { lookupAlias } from '@/lib/integrations/alias'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Ctx = { params: Promise<{ query: string }> }

/**
 * GET /api/wallet/alias/[query] — resolve an Argentine bank ALIAS or CBU/CVU
 * to its owner and bank through the Gorilla API integration. Authenticated so
 * this instance isn't an open proxy burning the upstream per-IP quota.
 */
export const GET = withErrorHandling(async (request: Request, ctx: Ctx) => {
  await authenticate(request)
  await rateLimit(request, RateLimitPresets.auth)
  const { query } = validateParams(await ctx.params, aliasQueryParam)
  const cfg = await getIntegrationConfig('alias')
  if (!cfg.enabled || !cfg.configured) {
    throw new NotFoundError('Alias lookup is not available')
  }
  return NextResponse.json(await lookupAlias(cfg.values.alias_api_url, query))
})
