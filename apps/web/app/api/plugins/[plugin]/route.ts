import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandling } from '@/types/server/error-handler'
import { authenticateWithPermission } from '@/lib/auth/unified-auth'
import { Permission } from '@/lib/auth/permissions'
import { ValidationError, NotFoundError } from '@/types/server/errors'
import {
  getPlugin,
  setPluginEnabled,
  isPluginEnabled,
  dispatchHookAndForget
} from '@/plugins/index'

const toggleSchema = z.object({ enabled: z.boolean() })

/**
 * PATCH /api/plugins/[plugin] — enable or disable a plugin.
 * Admin-only (SETTINGS_WRITE). Persists `plugin.<id>.enabled` in Settings,
 * runs the plugin's idempotent migrate() on enable, and dispatches the
 * plugin:toggled hook.
 */
export const PATCH = withErrorHandling(
  async (
    request: Request,
    { params }: { params: Promise<{ plugin: string }> }
  ) => {
    await authenticateWithPermission(request, Permission.SETTINGS_WRITE)

    const { plugin: pluginId } = await params
    if (!getPlugin(pluginId)) {
      throw new NotFoundError(`Unknown plugin: ${pluginId}`)
    }

    const body = await request.json().catch(() => null)
    const parsed = toggleSchema.safeParse(body)
    if (!parsed.success) {
      throw new ValidationError('Expected { enabled: boolean }')
    }

    await setPluginEnabled(pluginId, parsed.data.enabled)
    dispatchHookAndForget('plugin:toggled', {
      pluginId,
      enabled: parsed.data.enabled
    })

    return NextResponse.json({
      id: pluginId,
      enabled: await isPluginEnabled(pluginId)
    })
  }
)
