import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { checkRequestLimits } from '@/lib/middleware/request-limits'
import { validateBody, validateParams } from '@/lib/validation/middleware'
import {
  integrationIdParam,
  updateIntegrationSchema
} from '@/lib/validation/schemas'
import { withErrorHandling } from '@/types/server/error-handler'
import { ValidationError } from '@/types/server/errors'
import { invalidateHotSettingsCache } from '@/lib/settings'
import { eventBus } from '@/lib/events/event-bus'
import { ActivityEvent, logActivity } from '@/lib/activity-log'
import { INTEGRATIONS, enabledKey } from '@/lib/integrations/catalog'
import {
  getAllIntegrationSettings,
  isConfigured,
  sealSecret
} from '@/lib/integrations/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Ctx = { params: Promise<{ id: string }> }

/**
 * PUT /api/integrations/[id] — save an integration's config and/or toggle it.
 * Only the integration's own keys are accepted; a blank secret keeps the
 * stored one, a blank plain field resets it to its default.
 */
export const PUT = withErrorHandling(async (request: Request, ctx: Ctx) => {
  const auth = await authenticateWithPermission(
    request,
    Permission.INTEGRATIONS_MANAGE
  )
  await checkRequestLimits(request, 'json')
  const { id } = validateParams(await ctx.params, integrationIdParam)
  const body = await validateBody(request, updateIntegrationSchema)
  const meta = INTEGRATIONS[id]

  const writes: Record<string, string> = {}
  const deletes: string[] = []
  for (const [key, raw] of Object.entries(body.config ?? {})) {
    const field = meta.fields.find(f => f.key === key)
    if (!field) throw new ValidationError(`Unknown field "${key}" for ${id}`)
    const value = raw.trim()
    if (field.secret) {
      if (value) writes[key] = sealSecret(key, value)
    } else if (value) {
      if (field.key.endsWith('_url')) {
        try {
          const url = new URL(value)
          if (url.protocol !== 'https:' && url.protocol !== 'http:') throw 0
        } catch {
          throw new ValidationError(`${field.label} must be an http(s) URL`)
        }
      }
      writes[key] = value
    } else {
      deletes.push(key)
    }
  }
  if (body.enabled !== undefined) {
    writes[enabledKey(id)] = body.enabled ? 'true' : 'false'
  }

  // Refuse to switch on an integration that can't work.
  const current = await getAllIntegrationSettings()
  const next = { ...current, ...writes }
  for (const key of deletes) delete next[key]
  if (next[enabledKey(id)] === 'true' && !isConfigured(id, next)) {
    throw new ValidationError(`${meta.name} needs its required fields first`)
  }

  await prisma.$transaction([
    ...Object.entries(writes).map(([name, value]) =>
      prisma.settings.upsert({
        where: { name },
        create: { name, value },
        update: { value }
      })
    ),
    prisma.settings.deleteMany({ where: { name: { in: deletes } } })
  ])
  invalidateHotSettingsCache()
  eventBus.emit({ type: 'settings:updated', timestamp: Date.now() })

  const changedKeys = [...Object.keys(writes), ...deletes]
  logActivity.fireAndForget({
    category: 'SERVER',
    event: ActivityEvent.SERVER_SETTINGS_UPDATED,
    message: `Integration ${meta.name} updated: ${changedKeys.join(', ')}`,
    metadata: { integration: id, keys: changedKeys, changedBy: auth.pubkey }
  })

  return NextResponse.json({ ok: true })
})
