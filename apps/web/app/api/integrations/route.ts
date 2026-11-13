import { NextResponse } from 'next/server'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { withErrorHandling } from '@/types/server/error-handler'
import { INTEGRATIONS, INTEGRATION_IDS } from '@/lib/integrations/catalog'
import {
  getAllIntegrationSettings,
  isConfigured
} from '@/lib/integrations/server'
import { isProxyVaultConfigured } from '@/lib/proxy/vault'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/integrations — every integration with its admin-visible state.
 * Secret values are never returned, only `configured` flags per field.
 */
export const GET = withErrorHandling(async (request: Request) => {
  await authenticateWithPermission(request, Permission.INTEGRATIONS_MANAGE)
  const s = await getAllIntegrationSettings()

  return NextResponse.json({
    secretsEncrypted: isProxyVaultConfigured(),
    integrations: INTEGRATION_IDS.map(id => {
      const meta = INTEGRATIONS[id]
      return {
        ...meta,
        enabled: s[`${id}_enabled`] === 'true',
        configured: isConfigured(id, s),
        values: Object.fromEntries(
          meta.fields
            .filter(f => !f.secret)
            .map(f => [f.key, s[f.key] ?? f.defaultValue ?? ''])
        ),
        secretsConfigured: Object.fromEntries(
          meta.fields.filter(f => f.secret).map(f => [f.key, Boolean(s[f.key])])
        )
      }
    })
  })
})
