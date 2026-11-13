import { NextResponse } from 'next/server'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { rateLimit, RateLimitPresets } from '@/lib/middleware/rate-limit'
import { validateParams } from '@/lib/validation/middleware'
import { integrationIdParam } from '@/lib/validation/schemas'
import { withErrorHandling } from '@/types/server/error-handler'
import { getIntegrationConfig } from '@/lib/integrations/server'
import { bullBitcoinProvider } from '@/lib/integrations/bullbitcoin'
import { wapuProvider } from '@/lib/integrations/wapu'
import { testAliasApi } from '@/lib/integrations/alias'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/integrations/[id]/test — check the STORED credentials against the
 * provider (works whether or not the integration is enabled). Always 200:
 * `{ ok, detail }` carries the provider's answer for the admin card.
 */
export const POST = withErrorHandling(async (request: Request, ctx: Ctx) => {
  await authenticateWithPermission(request, Permission.INTEGRATIONS_MANAGE)
  await rateLimit(request, RateLimitPresets.sensitive)
  const { id } = validateParams(await ctx.params, integrationIdParam)
  const cfg = await getIntegrationConfig(id)
  if (!cfg.configured) {
    return NextResponse.json({ ok: false, detail: 'Not configured yet' })
  }
  try {
    const v = cfg.values
    const detail =
      id === 'bullbitcoin'
        ? await bullBitcoinProvider(v.bullbitcoin_api_key).test()
        : id === 'wapu'
          ? await wapuProvider(v.wapu_api_key).test()
          : await testAliasApi(v.alias_api_url)
    return NextResponse.json({ ok: true, detail })
  } catch (e) {
    return NextResponse.json({ ok: false, detail: (e as Error).message })
  }
})
