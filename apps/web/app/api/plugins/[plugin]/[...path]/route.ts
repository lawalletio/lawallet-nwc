import type { NextRequest } from 'next/server'
import { withErrorHandling } from '@/types/server/error-handler'
import { NotFoundError } from '@/types/server/errors'
import { getPlugin, isPluginEnabled } from '@/plugins/index'

/**
 * The single core catch-all for plugin-owned API routes:
 * /api/plugins/<id>/<...path> delegates to the plugin's `routes` handler.
 *
 * - Unknown or DISABLED plugins are a clean 404 — disabled plugins must not
 *   leak endpoints.
 * - Authentication is the plugin's responsibility, using the same
 *   unified-auth helpers core routes use.
 * - Handlers still run inside withErrorHandling, so typed ApiErrors map to
 *   proper status codes — zero new conventions.
 */
async function dispatch(
  request: NextRequest,
  { params }: { params: Promise<{ plugin: string; path: string[] }> }
) {
  const { plugin: pluginId, path } = await params

  const plugin = getPlugin(pluginId)
  if (!plugin?.routes || !(await isPluginEnabled(pluginId))) {
    throw new NotFoundError('Not found')
  }

  return plugin.routes(request, { method: request.method, path })
}

export const GET = withErrorHandling(dispatch)
export const POST = withErrorHandling(dispatch)
export const PUT = withErrorHandling(dispatch)
export const PATCH = withErrorHandling(dispatch)
export const DELETE = withErrorHandling(dispatch)
